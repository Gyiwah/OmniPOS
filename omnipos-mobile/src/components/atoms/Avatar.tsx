import { Image, StyleSheet, Text, View } from "react-native";
import { Colors } from "@/src/constants/colors";

type AvatarProps = {
  uri?: string | null;
  size?: number;
  fallbackInitials?: string;
};

export function Avatar({ uri, size = 40, fallbackInitials = "?" }: AvatarProps) {
  const initials = fallbackInitials.slice(0, 2).toUpperCase();
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.primaryBluePale,
    borderWidth: 2,
    borderColor: Colors.primaryBluePale,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  initials: {
    fontWeight: "700",
    color: Colors.primaryBlue,
  },
});
