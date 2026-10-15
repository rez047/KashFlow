import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

export function InventoryAccessNotice() {
  return <View style={styles.screen}>
    <Text style={styles.title}>Inventory access unavailable</Text>
    <Text style={styles.copy}>Your current business role does not include permission to view inventory screens.</Text>
  </View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#19272d', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  copy: { color: '#64716d', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 8, maxWidth: 320 },
})
