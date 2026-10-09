import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import React from 'react'
import { KashFlowProvider } from '../../src/components/KashFlowProvider'

export default function TabLayout() {
  return <KashFlowProvider>
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#0c9a79',
      tabBarInactiveTintColor: '#829098',
      tabBarStyle: { height: 69, paddingTop: 8, paddingBottom: 8, backgroundColor: '#fff', borderTopColor: '#e7e8e3', elevation: 0 },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
    }}>
      <Tabs.Screen name="home" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="count" options={{ title: 'Count', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="sync" options={{ title: 'Sync', tabBarIcon: ({ color, size }) => <Ionicons name="sync-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ href: null, tabBarButton: () => null }} />
    </Tabs>
  </KashFlowProvider>
}
