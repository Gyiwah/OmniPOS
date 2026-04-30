import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const productId = Array.isArray(id) ? id[0] : id;
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [name, setName] = useState("Sawyer Picaridin Insect Repellent");
  const [sku] = useState(productId ?? "050716005646");
  const [quantity, setQuantity] = useState("20");
  const [costPrice, setCostPrice] = useState("10.00");
  const [sellPrice, setSellPrice] = useState("13.00");
  const [tags, setTags] = useState("repellent, travel");

  async function pickImageFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setImageUri(result.assets[0]?.uri ?? null);
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
      setImageUri(result.assets[0]?.uri ?? null);
    }
  }

  function removeProduct() {
    Alert.alert("Delete product", "Remove this product from the store?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          // TODO: wire to product store/database removal action.
          router.back();
        },
      },
    ]);
  }

  return (
    <AppScrollScreen
      showBack
      fixedHeader
      title="Edit Product"
      right={
        <Pressable onPress={removeProduct} hitSlop={10} style={styles.trashBtn}>
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
          onChangeText={setName}
          placeholder="e.g. Sawyer Picaridin Insect Repellent"
          multiline
        />
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>Stock & pricing</Text>
        <TextInput
          label="Stock / Quantity"
          value={quantity}
          onChangeText={setQuantity}
          placeholder="0"
          keyboardType="number-pad"
        />
        <TextInput
          label="Cost price (optional)"
          value={costPrice}
          onChangeText={setCostPrice}
          placeholder="Optional"
          keyboardType="decimal-pad"
        />
        <TextInput
          label="Sell price"
          value={sellPrice}
          onChangeText={setSellPrice}
          placeholder="0.00"
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

      <PrimaryButton label="Update product" onPress={() => {}} />
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
