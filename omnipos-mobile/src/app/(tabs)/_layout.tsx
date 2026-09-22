import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router";
import { Colors } from "@/src/constants/colors";
import { useAuthStore } from "@/src/store/authStore";
import { canEditCatalogue } from "@/src/utils/permissions";

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  home: "home-outline",
  inventory: "cube-outline",
  orders: "receipt-outline",
  returns: "return-down-back-outline",
  analytics: "bar-chart-outline",
};

export default function TabsLayout() {
  const role = useAuthStore((s) => s.role);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const mayViewCatalogue = canEditCatalogue(isSuperAdmin ? "super_admin" : role);

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
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Inventory",
          href: mayViewCatalogue ? "/inventory" : null,
        }}
      />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="returns" options={{ title: "Returns" }} />
      <Tabs.Screen name="analytics" options={{ title: "Analytics" }} />
    </Tabs>
  );
}
