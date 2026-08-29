import Ionicons from "@expo/vector-icons/Ionicons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { Q } from "@nozbe/watermelondb";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
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
      }).catch(() => {});

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
        }).catch(() => {});
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
        }).catch(() => {});
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

  return (
    <AppScrollScreen
      showBack
      fixedHeader
      title="Add Product"
      subtitle="Create a catalog item with optional barcode scan."
    >
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

      <SectionCard>
        <Text style={styles.sectionTitle}>Identity</Text>
        <TextInput
          label="Product code / SKU"
          value={sku}
          onChangeText={(value) => {
            setSku(value);
            setErrors((prev) => ({ ...prev, sku: "" }));
          }}
          placeholder="Scan barcode or enter SKU"
          error={errors.sku}
          rightIcon={
            <Pressable onPress={() => setShowScanner((v) => !v)} hitSlop={10}>
              <Ionicons
                name={showScanner ? "close-circle-outline" : "scan-outline"}
                size={22}
                color={Colors.primaryBlue}
              />
            </Pressable>
          }
        />

        {showScanner ? (
          <View style={styles.scannerWrap}>
            <BarcodeScanner
              label="Align barcode inside frame to autofill SKU"
              onScan={(payload) => setSku(payload)}
            />
          </View>
        ) : null}

        <TextInput
          label="Product name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setErrors((prev) => ({ ...prev, name: "" }));
          }}
          placeholder="e.g. Sawyer Picaridin Insect Repellent"
          error={errors.name}
          multiline
        />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Stock & pricing</Text>
        <TextInput
          label="Stock / Quantity"
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
          placeholder="Optional (e.g. 15.00)"
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
          placeholder="5 (default threshold)"
          keyboardType="number-pad"
        />
        <Text style={styles.fieldHelper}>
          Threshold to trigger low stock & pre-order alerts (defaults to 5 if left blank).
        </Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Batch & Expiry (Optional)</Text>
        <TextInput
          label="Batch / Lot Number (Optional)"
          value={batchNumber}
          onChangeText={setBatchNumber}
          placeholder="e.g. LOT-2026A"
        />
        <DatePickerField
          label="Expiry Date (Optional)"
          value={expiryDate}
          onChange={(val) => setExpiryDate(val ?? "")}
          placeholder="Select expiry date"
          modalTitle="Select Product Expiry Date"
        />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Tags</Text>
        <TextInput
          value={tags}
          onChangeText={setTags}
          placeholder="e.g. brand, large, best seller"
          leftIcon={<Ionicons name="pricetag-outline" size={18} color={Colors.textMuted} />}
        />
      </SectionCard>

      <PrimaryButton label={saving ? "Saving..." : "Save product"} loading={saving} disabled={saving} onPress={() => void saveProduct()} />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    ...Typography.title,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
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
  scannerWrap: {
    gap: Spacing.sm,
  },
  fieldHelper: {
    ...Typography.caption,
    color: Colors.textMuted,
    marginTop: -2,
    marginBottom: Spacing.xs,
    fontSize: 12,
  },
});
