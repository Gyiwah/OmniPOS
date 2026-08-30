import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { DatePickerField } from "@/src/components/atoms/DatePickerField";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { createProductBatch } from "@/src/features/inventory/batchService";
import { recordPriceChange } from "@/src/features/inventory/priceHistoryService";
import { recordStockMovement } from "@/src/features/inventory/stockMovementService";
import { enqueueChange } from "@/src/sync/enqueue";
import { remoteImageUrlOnly } from "@/src/sync/productRow";
import { isLocalImageUri } from "@/src/services/storage";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useStoreSlice } from "@/src/store/storeSlice";
import { isNonNegativeNumber, isPositiveNumber, isRequired } from "@/src/utils/validators";

export default function AddProductScreen() {
  const router = useRouter();
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [tags, setTags] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({
    sku: "",
    name: "",
    quantity: "",
    costPrice: "",
    sellPrice: "",
  });

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

  function validateForm() {
    const cleanName = name.trim();
    const cleanSku = sku.trim();
    const quantityValue = quantity.trim();
    const sellPriceValue = sellPrice.trim();
    const costPriceValue = costPrice.trim();
    const parsedSellPrice = Number(sellPriceValue);
    const parsedCostPrice = costPriceValue ? Number(costPriceValue) : null;

    const nextErrors = {
      sku: "",
      name: "",
      quantity: "",
      costPrice: "",
      sellPrice: "",
    };

    if (!isRequired(cleanSku)) {
      nextErrors.sku = "SKU is required.";
    }
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

  async function saveProduct() {
    if (!activeStoreId) {
      Alert.alert("Store not selected", "Select an active store before saving products.");
      return;
    }

    const validationErrors = validateForm();
    if (Object.values(validationErrors).some(Boolean)) {
      return;
    }

    const cleanName = name.trim();
    const cleanSku = sku.trim();
    const stock = Number(quantity.trim());
    const sell = Number(sellPrice.trim());
    const cost = costPrice.trim().length ? Number(costPrice.trim()) : undefined;
    const barcode = cleanSku;
    const reorderVal = reorderLevel.trim().length ? Number(reorderLevel) : 5;

    setSaving(true);
    try {
      const existing = await database
        .get<Product>("products")
        .query(Q.where("store_id", activeStoreId), Q.where("sku", cleanSku))
        .fetch();
      if (existing.length > 0) {
        Alert.alert("Duplicate SKU", "A product with this SKU already exists in this store.");
        return;
      }

      const now = Date.now();
      const productId = Crypto.randomUUID();
      const parsedTags = tags
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      let createdId = productId;
      await database.write(async () => {
        await database.get<Product>("products").create((r) => {
          r._raw.id = productId;
          r.storeId = activeStoreId;
          r.remoteId = productId;
          r.name = cleanName;
          r.sku = cleanSku;
          r.barcode = barcode;
          r.stock = Math.floor(stock);
          r.sellPrice = sell;
          r.costPrice = cost;
          r.reorderLevel = Number.isFinite(reorderVal) ? reorderVal : 5;
          r.tags = tags.trim() || undefined;
          r.imageUrl = imageUri ?? undefined;
          r.updatedAt = now;
          r.dirty = true;
        });
      });

      // Record initial price history
      void recordPriceChange({
        storeId: activeStoreId,
        productId,
        oldSellPrice: 0,
        newSellPrice: sell,
        oldCostPrice: 0,
        newCostPrice: cost,
        reason: "Initial Product Creation",
      }).catch(() => { });

      // Record initial stock movement if stock > 0
      if (stock > 0) {
        void recordStockMovement({
          storeId: activeStoreId,
          productId,
          type: "STOCK_IN",
          quantity: Math.floor(stock),
          quantityBefore: 0,
          quantityAfter: Math.floor(stock),
          reason: "Initial Stock on Creation",
          notes: batchNumber.trim() ? `Batch #${batchNumber.trim()}` : undefined,
        }).catch(() => { });
      }

      // Create initial batch if batch number is provided
      if (batchNumber.trim()) {
        void createProductBatch({
          storeId: activeStoreId,
          productId,
          batchNumber: batchNumber.trim(),
          quantity: Math.floor(stock),
          costPrice: cost,
          expiryDate: expiryDate.trim() || undefined,
        }).catch(() => { });
      }

      await enqueueChange({
        storeId: activeStoreId,
        entity: "products",
        operation: "upsert",
        recordId: createdId,
        remoteId: productId,
        payload: {
          id: productId,
          name: cleanName,
          sku: cleanSku,
          barcode,
          stock: Math.floor(stock),
          price: sell,
          cost_price: cost ?? null,
          reorder_level: Number.isFinite(reorderVal) ? reorderVal : 5,
          image_url: remoteImageUrlOnly(imageUri),
          local_image_uri: imageUri && isLocalImageUri(imageUri) ? imageUri : null,
          local_image_mime: imageUri && isLocalImageUri(imageUri) ? imageMimeType : null,
          tags: parsedTags,
          is_active: true,
        },
      });

      const net = await NetInfo.fetch();
      if (net.isConnected) {
        const syncResult = await runSyncCycle(activeStoreId);
        if (!syncResult.ok) {
          Alert.alert(
            "Saved locally",
            syncResult.lastError
              ? `Cloud sync failed: ${syncResult.lastError}. The product will retry syncing automatically.`
              : "Cloud sync failed. The product will retry syncing automatically.",
          );
        } else {
          Alert.alert("Saved", "Product added and synced to the cloud.");
        }
      } else {
        Alert.alert("Saved locally", "Product saved on this device. It will sync when you're back online.");
      }

      router.replace("/inventory");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save product";
      Alert.alert("Save failed", message);
    } finally {
      setSaving(false);
    }
  }

  const costNum = Number(costPrice) || 0;
  const sellNum = Number(sellPrice) || 0;
  const marginPct = sellNum > 0 && costNum > 0 ? Math.round(((sellNum - costNum) / sellNum) * 100) : null;

  return (
    <AppScrollScreen
      showBack
      fixedHeader
      title="Create Product"
      subtitle="Register a new item, assign prices, barcodes, and batches."
    >
      {/* Product Image Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="image-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Product Photo</Text>
        </View>

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
                <Ionicons name="cube-outline" size={40} color={Colors.primaryBlue} />
                <Text style={styles.uploadPhotoText}>Add Photo</Text>
              </Pressable>
            )}
            <Pressable style={styles.imageFab} onPress={takePhoto} accessibilityRole="button">
              <Ionicons name="camera" size={20} color={Colors.textWhite} />
            </Pressable>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.photoHintTitle}>High-Resolution Photo</Text>
            <Text style={styles.photoHintSub}>Displayed in POS search, receipt documents, and inventory lists.</Text>
          </View>
        </View>
      </SectionCard>

      {/* Identity Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="barcode-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Identification & Barcode</Text>
        </View>

        <TextInput
          label="Product Code / SKU / Barcode *"
          value={sku}
          onChangeText={(value) => {
            setSku(value);
            setErrors((prev) => ({ ...prev, sku: "" }));
          }}
          placeholder="Scan barcode or type SKU"
          error={errors.sku}
          leftIcon={<Ionicons name="qr-code-outline" size={18} color={Colors.textMuted} />}
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10} style={{ padding: 4 }}>
              <Ionicons
                name={showScanner ? "close-circle" : "barcode-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />

        {showScanner ? (
          <View style={styles.scannerWrap}>
            <BarcodeScanner
              label="Point camera at product barcode to autofill SKU"
              onScan={(payload) => {
                setSku(payload);
                setShowScanner(false);
              }}
            />
          </View>
        ) : null}

        <TextInput
          label="Product Name *"
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

      {/* Pricing & Stock Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="pricetags-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Stock & Pricing Structure</Text>
        </View>

        <View style={styles.formGrid}>
          <View style={styles.gridCell}>
            <TextInput
              label="Initial Stock *"
              value={quantity}
              onChangeText={(value) => {
                setQuantity(value);
                setErrors((prev) => ({ ...prev, quantity: "" }));
              }}
              placeholder="0"
              error={errors.quantity}
              keyboardType="number-pad"
            />
          </View>

          <View style={styles.gridCell}>
            <TextInput
              label="Reorder Level"
              value={reorderLevel}
              onChangeText={setReorderLevel}
              placeholder="5"
              keyboardType="number-pad"
            />
          </View>
        </View>

        <View style={styles.formGrid}>
          <View style={styles.gridCell}>
            <TextInput
              label="Cost Price"
              value={costPrice}
              onChangeText={(value) => {
                setCostPrice(value);
                setErrors((prev) => ({ ...prev, costPrice: "" }));
              }}
              placeholder="0.00"
              error={errors.costPrice}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={styles.gridCell}>
            <TextInput
              label="Sell Price *"
              value={sellPrice}
              onChangeText={(value) => {
                setSellPrice(value);
                setErrors((prev) => ({ ...prev, sellPrice: "" }));
              }}
              placeholder="0.00"
              error={errors.sellPrice}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        {marginPct !== null ? (
          <View style={styles.marginPill}>
            <Ionicons name="trending-up" size={14} color="#15803d" />
            <Text style={styles.marginText}>
              Estimated Gross Margin: {marginPct}% ({toMoney(sellNum - costNum, "GHS")} profit/unit)
            </Text>
          </View>
        ) : null}
      </SectionCard>

      {/* Batch & Expiry Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="calendar-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Batch & Expiry Tracking</Text>
        </View>

        <TextInput
          label="Batch / Lot Number"
          value={batchNumber}
          onChangeText={setBatchNumber}
          placeholder="e.g. BATCH-2026-08"
          leftIcon={<Ionicons name="layers-outline" size={18} color={Colors.textMuted} />}
        />

        <DatePickerField
          label="Expiry Date"
          value={expiryDate}
          onChange={(val) => setExpiryDate(val ?? "")}
          placeholder="Select expiry date"
          modalTitle="Select Product Expiry Date"
        />
      </SectionCard>

      {/* Tags Card */}
      <SectionCard>
        <View style={styles.cardHeader}>
          <Ionicons name="bookmark-outline" size={20} color={Colors.primaryBlue} />
          <Text style={styles.sectionTitle}>Tags & Categorization</Text>
        </View>

        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="e.g. Beverages, Dairy, Best Seller, Promotion"
          leftIcon={<Ionicons name="pricetag-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      {/* Save Button */}
      <View style={styles.saveActionContainer}>
        <Pressable
          style={({ pressed }) => [
            styles.saveProductBtn,
            saving && styles.saveProductBtnDisabled,
            pressed && styles.saveProductBtnPressed,
          ]}
          disabled={saving}
          onPress={() => void saveProduct()}
        >
          {saving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Ionicons name="checkmark-circle-outline" size={20} color={Colors.white} />
          )}
          <Text style={styles.saveProductText}>{saving ? "Saving to Catalog..." : "Save Product to Catalog"}</Text>
        </Pressable>
      </View>
    </AppScrollScreen>
  );
}

function toMoney(value: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency === "NGN" ? "₦" : "₵";
  return `${symbol} ${value.toFixed(2)}`;
}

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    ...Typography.title,
    fontSize: 16,
    color: Colors.textPrimary,
  },
  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  imageWrap: {
    position: "relative",
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 20,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 1.5,
    borderColor: "#bfdbfe",
    borderStyle: "dashed",
    gap: 4,
  },
  uploadPhotoText: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
  imageFab: {
    position: "absolute",
    right: -6,
    bottom: -6,
    backgroundColor: Colors.primaryBlue,
    borderRadius: 18,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  photoHintTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.textPrimary,
  },
  photoHintSub: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  scannerWrap: {
    marginTop: Spacing.xs,
    borderRadius: Radius.card,
    overflow: "hidden",
  },
  formGrid: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  gridCell: {
    flex: 1,
  },
  marginPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bbf7d0",
    marginTop: Spacing.xs,
  },
  marginText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#15803d",
  },
  saveActionContainer: {
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  saveProductBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.primaryBlue,
    paddingVertical: 16,
    borderRadius: Radius.pill,
    shadowColor: Colors.primaryBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveProductBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  saveProductBtnDisabled: {
    opacity: 0.6,
  },
  saveProductText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "800",
  },
});

