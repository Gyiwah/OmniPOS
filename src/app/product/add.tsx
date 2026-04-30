import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/src/components/atoms/PrimaryButton";
import { TextInput } from "@/src/components/atoms/TextInput";
import { AppScrollScreen, SectionCard } from "@/src/components/layout/AppScrollScreen";
import { BarcodeScanner } from "@/src/components/organisms/BarcodeScanner";
import { Colors } from "@/src/constants/colors";
import { Radius } from "@/src/constants/radius";
import { Spacing } from "@/src/constants/spacing";
import { Typography } from "@/src/constants/typography";

export default function AddProductScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [tags, setTags] = useState("");
  const [showScanner, setShowScanner] = useState(false);

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
          onChangeText={setSku}
          placeholder="Scan barcode or enter SKU"
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

      <PrimaryButton label="Save product" onPress={() => {}} />
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
});
