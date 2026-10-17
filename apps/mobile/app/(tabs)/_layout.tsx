import { Ionicons } from '@expo/vector-icons'
import { Tabs } from 'expo-router'
import React from 'react'
import { KashFlowProvider, useKashFlow } from '../../src/components/KashFlowProvider'

export default function TabLayout() {
  return <KashFlowProvider>
    <WorkspaceTabs />
  </KashFlowProvider>
}

function WorkspaceTabs() {
  const { canUseInventory } = useKashFlow()
  return <Tabs initialRouteName="workspace" backBehavior="history" screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#0c9a79',
      tabBarInactiveTintColor: '#829098',
      tabBarStyle: { height: 69, paddingTop: 8, paddingBottom: 8, backgroundColor: '#fff', borderTopColor: '#e7e8e3', elevation: 0 },
      tabBarLabelStyle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
    }}>
      <Tabs.Screen name="workspace" options={{ title: 'Business', tabBarIcon: ({ color, size }) => <Ionicons name="business-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="home" options={{ href: canUseInventory ? undefined : null, tabBarButton: canUseInventory ? undefined : () => null, tabBarItemStyle: canUseInventory ? undefined : { display: 'none' }, title: 'Today', tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="stock" options={{ href: canUseInventory ? undefined : null, tabBarButton: canUseInventory ? undefined : () => null, tabBarItemStyle: canUseInventory ? undefined : { display: 'none' }, title: 'Stock', tabBarIcon: ({ color, size }) => <Ionicons name="cube-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="count" options={{ href: canUseInventory ? undefined : null, tabBarButton: canUseInventory ? undefined : () => null, tabBarItemStyle: canUseInventory ? undefined : { display: 'none' }, title: 'Count', tabBarIcon: ({ color, size }) => <Ionicons name="scan-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="sync" options={{ href: canUseInventory ? undefined : null, tabBarButton: canUseInventory ? undefined : () => null, tabBarItemStyle: canUseInventory ? undefined : { display: 'none' }, title: 'Sync', tabBarIcon: ({ color, size }) => <Ionicons name="sync-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="account-deletion" options={{ href: null }} />
    </Tabs>
}
