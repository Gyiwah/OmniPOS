import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { Colors } from "@/src/constants/colors";

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: "home-outline",
  inventory: "cube-outline",
  orders: "receipt-outline",
  analytics: "bar-chart-outline",
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: Colors.primaryBlue,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.divider,
        },
        tabBarIcon: ({ color, size }) => {
          const name = TAB_ICONS[route.name] ?? "ellipse-outline";
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    />
  );
}
