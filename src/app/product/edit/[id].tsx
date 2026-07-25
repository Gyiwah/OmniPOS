import Ionicons from "@expo/vector-icons/Ionicons";
import { Q } from "@nozbe/watermelondb";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";
import { database } from "@/src/database";
import type Product from "@/src/database/models/Product";
import { enqueueChange } from "@/src/sync/enqueue";
import { isLocalImageUri, resolveProductImageUrl } from "@/src/services/storage";
import { runSyncCycle } from "@/src/sync/syncEngine";
import { useStoreSlice } from "@/src/store/storeSlice";
import { isNonNegativeNumber, isPositiveNumber, isRequired } from "@/src/utils/validators";

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const routeParam = Array.isArray(id) ? id[0] : id;
  const activeStoreId = useStoreSlice((s) => s.activeStoreId);

  const [productRef, setProductRef] = useState<Product | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState(routeParam ?? "");
  const [quantity, setQuantity] = useState("0");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [tags, setTags] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({
    name: "",
    quantity: "",
    costPrice: "",
    sellPrice: "",
  });

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
        setTags("");
        if (found.imageUrl) {
          const resolved = await resolveProductImageUrl(found.imageUrl);
          setImageUri(resolved);
          setImageMimeType(null);
        } else {
          setImageUri(null);
          setImageMimeType(null);
        }
      } catch {
        // keep fallback values when product is unavailable in local cache
      }
    }
    void loadProduct();
    return () => {
      mounted = false;
    };
  }, [routeParam]);

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
    const stock = Number(quantity.trim());
    const sell = Number(sellPrice.trim());
    const cost = costPrice.trim().length ? Number(costPrice.trim()) : undefined;

    setSaving(true);
    try {
      const now = Date.now();
      const pickedLocalUri = imageUri && isLocalImageUri(imageUri) ? imageUri : null;
      const imageRef = productRef.imageUrl ?? null;

      await database.write(async () => {
        await productRef.update((rec) => {
          rec.name = cleanName;
          rec.stock = Math.floor(stock);
          rec.sellPrice = sell;
          rec.costPrice = cost;
          rec.barcode = sku.trim() || rec.barcode;
          if (pickedLocalUri) {
            rec.imageUrl = pickedLocalUri;
          }
          rec.updatedAt = now;
          rec.dirty = true;
        });
      });

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
          barcode: sku.trim() || productRef.sku,
          stock: Math.floor(stock),
          price: sell,
          cost_price: cost ?? null,
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
        const syncResult = await runSyncCycle(activeStoreId);
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
          editable={false}
          placeholder="Read-only product code"
        />
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

      <PrimaryButton
        label={saving ? "Updating..." : deleting ? "Deleting..." : "Update product"}
        loading={saving}
        disabled={deleting || saving}
        onPress={() => void updateProductNow()}
      />
    </AppScrollScreen>
  );
}

const styles = StyleSheet.create({
  trashBtn: {
    padding: Spacing.xs,
  },
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
});
