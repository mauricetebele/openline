import { Tabs } from 'expo-router'
import { Text, StyleSheet } from 'react-native'

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Orders: '📦',
    Process: '⚙️',
    Wholesale: '🏭',
    Settings: '☰',
  }
  return (
    <Text style={[styles.icon, focused && styles.iconFocused]}>
      {icons[label] ?? '•'}
    </Text>
  )
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#2a2a4a' },
        tabBarActiveTintColor: '#4361ee',
        tabBarInactiveTintColor: '#888',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Orders',
          tabBarIcon: ({ focused }) => <TabIcon label="Orders" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="process"
        options={{
          title: 'Process',
          tabBarIcon: ({ focused }) => <TabIcon label="Process" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="wholesale"
        options={{
          title: 'Wholesale',
          tabBarIcon: ({ focused }) => <TabIcon label="Wholesale" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ focused }) => <TabIcon label="Settings" focused={focused} />,
        }}
      />
    </Tabs>
  )
}

const styles = StyleSheet.create({
  icon: { fontSize: 20 },
  iconFocused: { fontSize: 22 },
})
