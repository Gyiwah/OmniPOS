import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { DatePickerField } from "@/src/components/atoms/DatePickerField";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { PriceTrendChart, type PricePoint } from "@/src/components/organisms/PriceTrendChart";
import { StockOutModal } from "@/src/components/organisms/StockOutModal";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type PriceHistory from "@/src/database/models/PriceHistory";
import type Product from "@/src/database/models/Product";
import type ProductBatch from "@/src/database/models/ProductBatch";
import type StockMovement from "@/src/database/models/StockMovement";
import {
  calculateExpiryStatus,
  createProductBatch,
  getProductBatches,
} from "@/src/features/inventory/batchService";
import {
  getProductPriceHistory,
  recordPriceChange,
} from "@/src/features/inventory/priceHistoryService";
import {
  getProductStockMovements,
  recordStockMovement,
} from "@/src/features/inventory/stockMovementService";
import { isLocalImageUri, resolveProductImageUrl } from "@/src/services/storage";
import { useSettingsStore } from "@/src/store/settingsStore";
import { useStoreSlice } from "@/src/store/storeSlice";
import { isNonNegativeNumber, isPositiveNumber, isRequired } from "@/src/utils/validators";
import { enqueueChange } from "@/src/sync/enqueue";
import { synchronise } from "@/src/sync";
import { useAuthStore } from "@/src/store/authStore";
import { canEditCatalogue } from "@/src/utils/permissions";

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const routeParam = Array.isArray(id) ? id[0] : id;
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const currency = useSettingsStore((s) => s.currency);
  const currencySymbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  const role = useAuthStore((s) => s.role);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const mayEditCatalogue = canEditCatalogue(isSuperAdmin ? "super_admin" : role);

  const [productRef, setProductRef] = useState<Product | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState(routeParam ?? "");
  const [quantity, setQuantity] = useState("0");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("5");
  const [tags, setTags] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({
    name: "",
    quantity: "",
    costPrice: "",
    sellPrice: "",
  });

  // Improvements State
  const [stockOutOpen, setStockOutOpen] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceHistory[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Add Batch Form
  const [showAddBatch, setShowAddBatch] = useState(false);
  const [batchNumInput, setBatchNumInput] = useState("");
  const [batchQtyInput, setBatchQtyInput] = useState("");
  const [batchExpiryInput, setBatchExpiryInput] = useState("");
  const [savingBatch, setSavingBatch] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function loadProduct() {
      if (!routeParam) return;
      try {
        let found: Product | null = null;
        try {
          found = await database.get<Product>("products").find(routeParam);
        } catch {
          const bySku = await database
            .get<Product>("products")
            .query(Q.where("sku", routeParam))
            .fetch();
          found = bySku[0] ?? null;
        }
        if (!mounted || !found) return;
        setProductRef(found);
        setName(found.name ?? "");
        setSku(found.sku ?? routeParam);
        setQuantity(String(found.stock ?? 0));
        setCostPrice(found.costPrice == null ? "" : String(found.costPrice));
        setSellPrice(String(found.sellPrice ?? 0));
        setReorderLevel(String(found.reorderLevel ?? 5));
        setTags(found.tags ?? "");

        if (found.imageUrl) {
          const resolved = await resolveProductImageUrl(found.imageUrl);
          setImageUri(resolved);
          setImageMimeType(null);
        } else {
          setImageUri(null);
          setImageMimeType(null);
        }

        // Load auxiliary history data
        if (activeStoreId) {
          const [pHist, pBatches, pMoves] = await Promise.all([
            getProductPriceHistory(activeStoreId, found.id),
            getProductBatches(activeStoreId, found.id),
            getProductStockMovements(activeStoreId, found.id),
          ]);
          if (mounted) {
            setPriceHistory(pHist);
            setBatches(pBatches);
            setMovements(pMoves);
          }
        }
      } catch {
        // fallback
      }
    }
    void loadProduct();
    return () => {
      mounted = false;
    };
  }, [routeParam, activeStoreId]);

  const trendData: PricePoint[] = useMemo(() => {
    if (priceHistory.length === 0) {
      if (!productRef) return [];
      return [
        {
          date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          sellPrice: Number(productRef.sellPrice ?? 0),
          costPrice: productRef.costPrice,
          reason: "Current Price",
        },
      ];
    }

    return priceHistory.map((ph) => ({
      date: new Date(ph.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sellPrice: Number(ph.newSellPrice ?? 0),
      costPrice: ph.newCostPrice,
      reason: ph.reason,
    }));
  }, [priceHistory, productRef]);

  async function pickImageFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setImageUri(asset?.uri ?? null);
      setImageMimeType(asset?.mimeType ?? null);
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Camera permission needed", "Enable camera access to capture a product image.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setImageUri(asset?.uri ?? null);
      setImageMimeType(asset?.mimeType ?? null);
    }
  }

  async function handleAddBatch() {
    if (!activeStoreId || !productRef) return;
    const bNum = batchNumInput.trim();
    const bQty = Number(batchQtyInput || 0);
    if (!bNum) {
      Alert.alert("Missing field", "Batch / Lot number is required.");
      return;
    }
    if (!Number.isFinite(bQty) || bQty < 0) {
      Alert.alert("Invalid quantity", "Batch quantity must be a valid non-negative number.");
      return;
    }

    setSavingBatch(true);
    try {
      const newBatch = await createProductBatch({
        storeId: activeStoreId,
        productId: productRef.id,
        batchNumber: bNum,
        quantity: Math.floor(bQty),
        costPrice: costPrice ? Number(costPrice) : undefined,
        expiryDate: batchExpiryInput.trim() || undefined,
      });

      if (bQty > 0) {
        // Increase product stock and log movement
        const currentStock = Number(productRef.stock ?? 0);
        const nextStock = currentStock + Math.floor(bQty);
        await database.write(async () => {
          await productRef.update((rec) => {
            rec.stock = nextStock;
            rec.updatedAt = Date.now();
            rec.dirty = true;
          });
        });
        setQuantity(String(nextStock));

        await recordStockMovement({
          storeId: activeStoreId,
          productId: productRef.id,
          batchId: newBatch.id,
          type: "STOCK_IN",
          quantity: Math.floor(bQty),
          quantityBefore: currentStock,
          quantityAfter: nextStock,
          reason: "New Batch Received",
          notes: `Batch #${bNum}`,
        });
      }

      const [pBatches, pMoves] = await Promise.all([
        getProductBatches(activeStoreId, productRef.id),
        getProductStockMovements(activeStoreId, productRef.id),
      ]);
      setBatches(pBatches);
      setMovements(pMoves);

      setBatchNumInput("");
      setBatchQtyInput("");
      setBatchExpiryInput("");
      setShowAddBatch(false);
      Alert.alert("Batch Added", `Batch #${bNum} created successfully.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to add batch";
      Alert.alert("Batch creation failed", msg);
    } finally {
      setSavingBatch(false);
    }
  }

  async function deleteProductNow() {
    if (!activeStoreId) {
      Alert.alert("Store not selected", "Select a store before deleting products.");
      return;
    }
    if (!productRef) {
      Alert.alert("Product not found", "This product is not available in the local cache yet.");
      return;
    }

    setDeleting(true);
    try {
      const remoteId = productRef.remoteId;
      const skuValue = productRef.sku;

      await database.write(async () => {
        await productRef.destroyPermanently();
      });

      await enqueueChange({
        storeId: activeStoreId,
        entity: "products",
        operation: "delete",
        payload: {
          remote_id: remoteId,
          sku: skuValue,
        },
        recordId: productRef.id,
        remoteId,
      });

      router.replace("/inventory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      Alert.alert("Delete failed", message);
    } finally {
      setDeleting(false);
    }
  }

  function confirmDelete() {
    Alert.alert("Delete product", "Remove this product from the store?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteProductNow();
        },
      },
    ]);
  }

  function validateForm() {
    const cleanName = name.trim();
    const quantityValue = quantity.trim();
    const sellPriceValue = sellPrice.trim();
    const costPriceValue = costPrice.trim();
    const parsedSellPrice = Number(sellPriceValue);
    const parsedCostPrice = costPriceValue ? Number(costPriceValue) : null;

    const nextErrors = {
      name: "",
      quantity: "",
      costPrice: "",
      sellPrice: "",
    };

    if (!isRequired(cleanName)) {
      nextErrors.name = "Product name is required.";
    }
    if (!quantityValue || !isNonNegativeNumber(quantityValue)) {
      nextErrors.quantity = "Enter a valid non-negative quantity.";
    }
    if (costPriceValue && !isNonNegativeNumber(costPriceValue)) {
      nextErrors.costPrice = "Cost price must be a non-negative number.";
    }
    if (!sellPriceValue || !isPositiveNumber(sellPriceValue)) {
      nextErrors.sellPrice = "Sell price must be at least 1.";
    } else if (parsedCostPrice != null && Number.isFinite(parsedCostPrice) && parsedSellPrice < parsedCostPrice) {
      nextErrors.sellPrice = "Sell price must be at least the cost price.";
    }

    setErrors(nextErrors);
    return nextErrors;
  }

  async function updateProductNow() {
    if (!activeStoreId) {
      Alert.alert("Store not selected", "Select a store before updating products.");
      return;
    }
    if (!productRef) {
      Alert.alert("Product not found", "This product is not available in the local cache yet.");
      return;
    }

    const validationErrors = validateForm();
    if (Object.values(validationErrors).some(Boolean)) {
      return;
    }

    const cleanName = name.trim();
    const stock = Number(quantity || 0);
    const sell = Number(sellPrice || 0);
    const cost = costPrice.trim().length ? Number(costPrice) : undefined;
    const reorderVal = reorderLevel.trim().length ? Number(reorderLevel) : 5;

    setSaving(true);
    try {
      const now = Date.now();
      const pickedLocalUri = imageUri && isLocalImageUri(imageUri) ? imageUri : null;
      const imageRef = productRef.imageUrl ?? null;

      const oldStock = Number(productRef.stock ?? 0);
      const oldSell = Number(productRef.sellPrice ?? 0);
      const oldCost = productRef.costPrice;

      await database.write(async () => {
        await productRef.update((rec) => {
          rec.name = cleanName;
          rec.stock = Math.floor(stock);
          rec.sellPrice = sell;
          rec.costPrice = cost;
          rec.reorderLevel = Number.isFinite(reorderVal) ? reorderVal : 5;
          rec.tags = tags.trim() || undefined;
          rec.barcode = sku.trim() || rec.barcode;
          if (pickedLocalUri) {
            rec.imageUrl = pickedLocalUri;
          }
          rec.updatedAt = now;
          rec.dirty = true;
        });
      });

      // Check if price changed -> record in price history
      if (oldSell !== sell || oldCost !== cost) {
        void recordPriceChange({
          storeId: activeStoreId,
          productId: productRef.id,
          oldSellPrice: oldSell,
          newSellPrice: sell,
          oldCostPrice: oldCost,
          newCostPrice: cost,
          reason: "Product Price Edit",
        }).catch(() => {});
      }

      // Check if stock changed directly -> record stock movement
      if (oldStock !== Math.floor(stock)) {
        const diff = Math.floor(stock) - oldStock;
        void recordStockMovement({
          storeId: activeStoreId,
          productId: productRef.id,
          type: diff > 0 ? "STOCK_IN" : "ADJUSTMENT",
          quantity: diff,
          quantityBefore: oldStock,
          quantityAfter: Math.floor(stock),
          reason: "Direct Inventory Adjustment",
        }).catch(() => {});
      }

      await enqueueChange({
        storeId: activeStoreId,
        entity: "products",
        operation: "upsert",
        recordId: productRef.id,
        remoteId: productRef.remoteId,
        payload: {
          id: productRef.remoteId ?? productRef.id,
          name: cleanName,
          sku: productRef.sku,
          barcode: productRef.sku,
          stock: Math.floor(stock),
          price: sell,
          cost_price: cost ?? null,
          reorder_level: Number.isFinite(reorderVal) ? reorderVal : 5,
          image_url: imageRef,
          local_image_uri: pickedLocalUri,
          local_image_mime: pickedLocalUri ? imageMimeType : null,
          tags: tags
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          is_active: true,
        },
      });

      const net = await NetInfo.fetch();
      if (net.isConnected) {
        const syncResult = await synchronise(activeStoreId);
        if (!syncResult.ok) {
          Alert.alert(
            "Updated locally",
            syncResult.lastError
              ? `Cloud sync failed: ${syncResult.lastError}. Changes will retry syncing automatically.`
              : "Cloud sync failed. Changes will retry syncing automatically.",
          );
        } else {
          Alert.alert("Updated", "Product updated and synced to the cloud.");
        }
      } else {
        Alert.alert("Updated locally", "Changes saved on this device. They will sync when you're back online.");
      }

      router.replace("/inventory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed";
      Alert.alert("Update failed", message);
    } finally {
      setSaving(false);
    }
  }

  if (!mayEditCatalogue) {
    return (
      <AppScrollScreen showBack title="Edit Product">
        <SectionCard style={{ alignItems: "center", paddingVertical: Spacing.xl, gap: Spacing.sm }}>
          <Ionicons name="lock-closed-outline" size={48} color={Colors.danger} />
          <Text style={{ fontSize: 17, fontWeight: "800", color: Colors.textPrimary }}>
            Access Restricted
          </Text>
          <Text style={{ fontSize: 13, color: Colors.textMuted, textAlign: "center", paddingHorizontal: Spacing.lg }}>
            Cashiers are not authorized to view or modify products in the catalogue.
          </Text>
        </SectionCard>
      </AppScrollScreen>
    );
  }

  return (
    <AppScrollScreen
      showBack
      fixedHeader
      title="Edit Product"
      right={
        <Pressable onPress={confirmDelete} hitSlop={10} style={styles.trashBtn} disabled={deleting}>
          <Ionicons name="trash-outline" size={28} color={Colors.danger} />
        </Pressable>
      }
    >
      {/* Product Image Section */}
      <SectionCard>
        <Text style={styles.sectionTitle}>Product image</Text>
        <View style={styles.imageRow}>
          <View style={styles.imageWrap}>
            {imageUri ? (
              <Pressable onPress={() => void pickImageFromLibrary()} accessibilityRole="button">
                <Image source={{ uri: imageUri }} style={styles.image} />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void pickImageFromLibrary()}
                accessibilityRole="button"
                style={[styles.image, styles.imagePlaceholder]}
              >
                <Ionicons name="image-outline" size={34} color={Colors.primaryBlue} />
              </Pressable>
            )}
            <Pressable style={styles.imageFab} onPress={takePhoto} accessibilityRole="button">
              <Ionicons name="camera" size={22} color={Colors.textWhite} />
            </Pressable>
          </View>
        </View>
      </SectionCard>

      {/* Identity Section */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="barcode-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Product Identification</Text>
        </View>

        <TextInput
          label="Barcode / Product SKU (Locked)"
          value={sku}
          editable={false}
          leftIcon={<Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} />}
        />
        <Text style={styles.fieldHelper}>
          Barcode / SKU is the primary unique identifier and cannot be modified after creation.
        </Text>

        <TextInput
          label="Product name *"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setErrors((prev) => ({ ...prev, name: "" }));
          }}
          placeholder="e.g. Cerelac Wheat 400g"
          error={errors.name}
          leftIcon={<Ionicons name="cube-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      {/* Stock & Pricing Section */}
      <SectionCard>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Stock & pricing</Text>
          <Pressable
            style={styles.stockOutActionBtn}
            onPress={() => setStockOutOpen(true)}
          >
            <Ionicons name="remove-circle-outline" size={16} color={Colors.danger} />
            <Text style={styles.stockOutActionText}>Stock Out / Write-off</Text>
          </Pressable>
        </View>

        <TextInput
          label="Current Stock / Quantity"
          value={quantity}
          onChangeText={(value) => {
            setQuantity(value);
            setErrors((prev) => ({ ...prev, quantity: "" }));
          }}
          placeholder="0"
          error={errors.quantity}
          keyboardType="number-pad"
        />
        <TextInput
          label="Cost price (optional)"
          value={costPrice}
          onChangeText={(value) => {
            setCostPrice(value);
            setErrors((prev) => ({ ...prev, costPrice: "" }));
          }}
          placeholder="Optional"
          error={errors.costPrice}
          keyboardType="decimal-pad"
        />
        <TextInput
          label="Sell price"
          value={sellPrice}
          onChangeText={(value) => {
            setSellPrice(value);
            setErrors((prev) => ({ ...prev, sellPrice: "" }));
          }}
          placeholder="0.00"
          error={errors.sellPrice}
          keyboardType="decimal-pad"
        />
        <TextInput
          label="Reorder / Pre-order level (Optional)"
          value={reorderLevel}
          onChangeText={setReorderLevel}
          placeholder="5"
          keyboardType="number-pad"
        />
      </SectionCard>

      {/* Price History & Trend Map Section */}
      <SectionCard>
        <Text style={styles.sectionTitle}>Price History & Trend</Text>
        <PriceTrendChart
          data={trendData}
          currencySymbol={currencySymbol}
          width={330}
          height={170}
        />
        {priceHistory.length > 0 ? (
          <View style={styles.historyList}>
            {priceHistory.slice(0, 5).map((ph) => (
              <View key={ph.id} style={styles.historyItemRow}>
                <View>
                  <Text style={styles.historyItemTitle}>{ph.reason || "Price Change"}</Text>
                  <Text style={styles.historyItemDate}>
                    {new Date(ph.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </Text>
                </View>
                <Text style={styles.historyItemPrice}>
                  {currencySymbol} {Number(ph.newSellPrice).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </SectionCard>

      {/* Batches & Expiry Dates Section */}
      <SectionCard>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Batches & Expiry</Text>
          <Pressable
            style={styles.addBatchBtn}
            onPress={() => setShowAddBatch((v) => !v)}
          >
            <Ionicons
              name={showAddBatch ? "close" : "add"}
              size={16}
              color={Colors.primaryBlue}
            />
            <Text style={styles.addBatchBtnText}>
              {showAddBatch ? "Cancel" : "Add Batch"}
            </Text>
          </Pressable>
        </View>

        {showAddBatch ? (
          <View style={styles.addBatchCard}>
            <TextInput
              label="Batch / Lot Number"
              value={batchNumInput}
              onChangeText={setBatchNumInput}
              placeholder="e.g. LOT-2026B"
            />
            <TextInput
              label="Batch Quantity"
              value={batchQtyInput}
              onChangeText={setBatchQtyInput}
              placeholder="Units in this batch"
              keyboardType="number-pad"
            />
            <DatePickerField
              label="Expiry Date"
              value={batchExpiryInput}
              onChange={(val) => setBatchExpiryInput(val ?? "")}
              placeholder="Select expiry date"
              modalTitle="Select Batch Expiry Date"
            />
            <PrimaryButton
              label={savingBatch ? "Adding..." : "Save Batch"}
              loading={savingBatch}
              disabled={savingBatch}
              onPress={() => void handleAddBatch()}
            />
          </View>
        ) : null}

        {batches.length > 0 ? (
          <View style={styles.batchList}>
            {batches.map((b) => {
              const expInfo = calculateExpiryStatus(b.expiryDate);
              const isExpired = expInfo.status === "expired";
              const isSoon = expInfo.status === "expiring_soon";

              return (
                <View key={b.id} style={styles.batchCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.batchNum}>Batch #{b.batchNumber}</Text>
                    <Text style={styles.batchSub}>
                      {b.expiryDate ? `Expiry: ${b.expiryDate}` : "No expiry date set"}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={styles.batchQty}>{b.quantity} units</Text>
                    {b.expiryDate ? (
                      <View
                        style={[
                          styles.expPill,
                          isExpired
                            ? styles.expPillExpired
                            : isSoon
                            ? styles.expPillSoon
                            : styles.expPillGood,
                        ]}
                      >
                        <Text
                          style={[
                            styles.expText,
                            isExpired
                              ? styles.expTextExpired
                              : isSoon
                              ? styles.expTextSoon
                              : styles.expTextGood,
                          ]}
                        >
                          {expInfo.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptySubText}>No batches recorded for this product.</Text>
        )}
      </SectionCard>

      {/* Stock Movement Timeline Section */}
      <SectionCard>
        <Text style={styles.sectionTitle}>Stock Movement History</Text>
        {movements.length > 0 ? (
          <View style={styles.movementList}>
            {movements.slice(0, 6).map((m) => {
              const isPositive = m.quantity > 0;
              return (
                <View key={m.id} style={styles.movementRow}>
                  <View style={styles.movementIconWrap}>
                    <Ionicons
                      name={
                        m.type === "SALE"
                          ? "cart-outline"
                          : m.type === "RETURN"
                          ? "arrow-undo-outline"
                          : isPositive
                          ? "add-circle-outline"
                          : "remove-circle-outline"
                      }
                      size={20}
                      color={isPositive ? "#16a34a" : Colors.danger}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.movementReason}>{m.reason}</Text>
                    <Text style={styles.movementDate}>
                      {new Date(m.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text
                      style={[
                        styles.movementQty,
                        isPositive ? styles.qtyPositive : styles.qtyNegative,
                      ]}
                    >
                      {isPositive ? "+" : ""}
                      {m.quantity}
                    </Text>
                    <Text style={styles.movementBalance}>Bal: {m.quantityAfter}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.emptySubText}>No stock movements logged yet.</Text>
        )}
      </SectionCard>

      {/* Tags Section */}
      <SectionCard>
        <Text style={styles.sectionTitle}>Tags</Text>
        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="e.g. brand, large, best seller"
          leftIcon={<Ionicons name="pricetag-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      <PrimaryButton
        label={saving ? "Updating..." : deleting ? "Deleting..." : "Update product"}
        loading={saving}
        disabled={deleting || saving}
        onPress={() => void updateProductNow()}
      />

      {/* Stock Out Modal */}
      {productRef && activeStoreId ? (
        <StockOutModal
          visible={stockOutOpen}
          onClose={() => setStockOutOpen(false)}
          storeId={activeStoreId}
          productId={productRef.id}
          productName={productRef.name}
          currentStock={Number(productRef.stock ?? 0)}
          onStockUpdated={(newStock) => {
            setQuantity(String(newStock));
            void getProductStockMovements(activeStoreId, productRef.id).then(setMovements);
            void getProductBatches(activeStoreId, productRef.id).then(setBatches);
          }}
        />
      ) : null}
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  trashBtn: {
    padding: Spacing.xs,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  stockOutActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fef2f2",
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  stockOutActionText: {
    fontSize: 12,
    color: Colors.danger,
    fontWeight: "700",
  },
  addBatchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.primaryBluePale,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  addBatchBtnText: {
    fontSize: 12,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  addBatchCard: {
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.xs,
  },
  batchList: {
    gap: Spacing.xs,
  },
  batchCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.background,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  batchNum: {
    ...Typography.body,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  batchSub: {
    ...Typography.caption,
    color: Colors.textMuted,
  },
  batchQty: {
    ...Typography.caption,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  expPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  expPillExpired: {
    backgroundColor: "#fee2e2",
  },
  expPillSoon: {
    backgroundColor: "#fef3c7",
  },
  expPillGood: {
    backgroundColor: "#dcfce7",
  },
  expText: {
    fontSize: 10,
    fontWeight: "700",
  },
  expTextExpired: {
    color: "#dc2626",
  },
  expTextSoon: {
    color: "#d97706",
  },
  expTextGood: {
    color: "#16a34a",
  },
  historyList: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  historyItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  historyItemTitle: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  historyItemDate: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontSize: 11,
  },
  historyItemPrice: {
    ...Typography.caption,
    color: Colors.primaryBlue,
    fontWeight: "700",
  },
  movementList: {
    gap: Spacing.xs,
  },
  movementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  movementIconWrap: {
    width: 28,
    alignItems: "center",
  },
  movementReason: {
    ...Typography.caption,
    fontWeight: "600",
    color: Colors.textPrimary,
  },
  movementDate: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontSize: 11,
  },
  movementQty: {
    ...Typography.caption,
    fontWeight: "700",
    fontSize: 13,
  },
  qtyPositive: {
    color: "#16a34a",
  },
  qtyNegative: {
    color: Colors.danger,
  },
  movementBalance: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontSize: 10,
  },
  emptySubText: {
    ...Typography.caption,
    color: Colors.textMuted,
    fontStyle: "italic",
    paddingVertical: Spacing.xs,
  },
  imageRow: {
    alignItems: "center",
    justifyContent: "center",
  },
  imageWrap: {
    position: "relative",
  },
  image: {
    width: 132,
    height: 132,
    borderRadius: 66,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageFab: {
    position: "absolute",
    right: -6,
    bottom: -6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: Radius.pill,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.xs,
  },
  fieldHelper: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.sm,
  },
});
