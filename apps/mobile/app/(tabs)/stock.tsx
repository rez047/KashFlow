import { Ionicons } from '@expo/vector-icons'
import { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useKashFlow } from './_layout'

export default function StockScreen() {
  const { online, snapshot, loading, syncing, refresh } = useKashFlow()
  const [query, setQuery] = useState('')
  const [locationId, setLocationId] = useState('all')
  const items = useMemo(() => (snapshot?.items ?? []).filter((item) => {
    const q = query.trim().toLowerCase()
    return !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
  }), [query, snapshot?.items])
  const locations = snapshot?.locations.filter((location) => location.active) ?? []
  const totalUnits = items.reduce((sum, item) => sum + (locationId === 'all'
    ? (snapshot?.stock.filter((stock) => stock.item_id === item.id).reduce((qty, stock) => qty + stock.quantity, 0) ?? 0)
    : (snapshot?.stock.find((stock) => stock.item_id === item.id && stock.location_id === locationId)?.quantity ?? 0)), 0)

  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.headline}><View><Text style={styles.kicker}>YOUR CATALOG</Text><Text style={styles.title}>Stock room</Text></View><Pressable accessibilityLabel="Refresh inventory" onPress={() => void refresh()} style={styles.refresh}>{syncing || loading ? <ActivityIndicator size="small" color="#128a70" /> : <Ionicons name="refresh-outline" size={18} color="#277665" />}</Pressable></View>
      <Text style={styles.subtitle}>{snapshot?.workspaceName ?? 'Inventory'} · last saved snapshot</Text>

      <View style={styles.summary}><View style={styles.summaryIcon}><Ionicons name="cube-outline" size={19} color="#0e9173" /></View><View style={styles.summaryText}><Text style={styles.summaryValue}>{items.length}<Text style={styles.summarySlash}> / </Text>{snapshot?.items.length ?? 0}</Text><Text style={styles.summaryLabel}>ITEMS IN THIS VIEW</Text></View><View style={styles.summaryRule} /><View style={styles.summaryText}><Text style={styles.summaryValue}>{totalUnits.toLocaleString()}</Text><Text style={styles.summaryLabel}>UNITS ON HAND</Text></View></View>

      <View style={styles.search}><Ionicons name="search-outline" size={17} color="#87938e" /><TextInput value={query} onChangeText={setQuery} placeholder="Search name, SKU or category" placeholderTextColor="#a1aaa5" style={styles.searchInput} autoCorrect={false} /><Text style={styles.searchHint}>{items.length}</Text></View>
      <Text style={styles.filterLabel}>LOCATION</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Pressable onPress={() => setLocationId('all')} style={[styles.chip, locationId === 'all' && styles.chipActive]}><Text style={[styles.chipText, locationId === 'all' && styles.chipTextActive]}>All locations</Text></Pressable>
        {locations.map((location) => <Pressable key={location.id} onPress={() => setLocationId(location.id)} style={[styles.chip, locationId === location.id && styles.chipActive]}><Text style={[styles.chipText, locationId === location.id && styles.chipTextActive]}>{location.name}</Text></Pressable>)}
      </ScrollView>

      <View style={styles.listHeader}><Text style={styles.listLabel}>PRODUCTS</Text><Text style={styles.listLabel}>{locationId === 'all' ? 'ON HAND' : locations.find((location) => location.id === locationId)?.code.toUpperCase()}</Text></View>
      <View style={styles.list}>
        {items.map((item, index) => {
          const qty = locationId === 'all'
            ? snapshot?.stock.filter((stock) => stock.item_id === item.id).reduce((sum, stock) => sum + stock.quantity, 0) ?? 0
            : snapshot?.stock.find((stock) => stock.item_id === item.id && stock.location_id === locationId)?.quantity ?? 0
          return <View key={item.id} style={[styles.item, index > 0 && styles.itemBorder]}>
            <View style={styles.productMark}><Text style={styles.productInitial}>{item.name.trim().slice(0, 1).toUpperCase()}</Text></View>
            <View style={styles.itemBody}><Text numberOfLines={1} style={styles.itemName}>{item.name}</Text><Text numberOfLines={1} style={styles.itemMeta}>{item.sku ? `SKU ${item.sku}` : item.category || 'No SKU'}{item.category && item.sku ? ` · ${item.category}` : ''}</Text></View>
            <View style={styles.qtyBlock}><Text style={[styles.qty, qty <= 0 && styles.qtyLow]}>{qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}</Text><Text style={styles.unit}>{item.unit || 'units'}</Text></View>
          </View>
        })}
        {items.length === 0 && <View style={styles.empty}><Ionicons name="file-tray-outline" size={22} color="#9aa7a0" /><Text style={styles.emptyText}>{snapshot?.items.length ? 'No products match this search.' : 'No inventory is cached for this business yet.'}</Text></View>}
      </View>
      {!online && <View style={styles.offlineNote}><Ionicons name="cloud-offline-outline" size={15} color="#a87a36" /><Text style={styles.offlineText}>Last known quantities. Other sales may have changed stock since this snapshot.</Text></View>}
      {!snapshot && !loading && <Pressable onPress={() => void refresh()} style={styles.reload}><Text style={styles.reloadText}>Connect to load inventory</Text><Ionicons name="arrow-forward" size={16} color="#fff" /></Pressable>}
    </ScrollView>
  </View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1' }, page: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 28, maxWidth: 650, width: '100%', alignSelf: 'center' },
  headline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, kicker: { color: '#128d72', fontSize: 8, letterSpacing: 1.7, fontWeight: '900' }, title: { color: '#19272d', fontSize: 25, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 }, subtitle: { color: '#89938e', fontSize: 10, marginTop: 5 },
  refresh: { width: 39, height: 39, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8e1', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderColor: '#e7e9e3', borderWidth: 1, borderRadius: 17, padding: 14, marginTop: 19 }, summaryIcon: { width: 37, height: 37, borderRadius: 13, backgroundColor: '#e6f4ee', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, summaryText: { flex: 1 }, summaryValue: { color: '#1d3034', fontSize: 17, fontWeight: '800', letterSpacing: -0.4 }, summarySlash: { color: '#a6b0aa', fontWeight: '500' }, summaryLabel: { color: '#8b9690', fontSize: 7, letterSpacing: 1.1, fontWeight: '900', marginTop: 3 }, summaryRule: { height: 31, width: 1, backgroundColor: '#eceee8', marginHorizontal: 13 },
  search: { height: 47, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderColor: '#e7e9e3', borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, marginTop: 16 }, searchInput: { flex: 1, color: '#26373a', fontSize: 11, height: '100%' }, searchHint: { minWidth: 22, textAlign: 'right', color: '#97a29d', fontSize: 9, fontWeight: '800' },
  filterLabel: { color: '#8b9690', fontSize: 8, fontWeight: '900', letterSpacing: 1.3, marginTop: 18, marginBottom: 8 }, chips: { gap: 7, paddingRight: 18 }, chip: { height: 31, borderRadius: 11, backgroundColor: '#eceee9', paddingHorizontal: 12, justifyContent: 'center' }, chipActive: { backgroundColor: '#15333a' }, chipText: { color: '#65736f', fontSize: 9, fontWeight: '700' }, chipTextActive: { color: '#fff' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 23, paddingHorizontal: 4, paddingBottom: 8 }, listLabel: { color: '#9aa39e', fontSize: 7, fontWeight: '900', letterSpacing: 1.4 }, list: { backgroundColor: '#fff', borderColor: '#e8eae4', borderWidth: 1, borderRadius: 17, paddingHorizontal: 12 }, item: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10 }, itemBorder: { borderTopWidth: 1, borderTopColor: '#f0f1ed' },
  productMark: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#eef3ee', alignItems: 'center', justifyContent: 'center' }, productInitial: { color: '#58786f', fontWeight: '800', fontSize: 12 }, itemBody: { flex: 1 }, itemName: { color: '#263539', fontSize: 11, fontWeight: '800' }, itemMeta: { color: '#98a19c', fontSize: 8, marginTop: 4 }, qtyBlock: { alignItems: 'flex-end', minWidth: 53 }, qty: { color: '#25363a', fontSize: 14, fontWeight: '800' }, qtyLow: { color: '#be8040' }, unit: { color: '#9aa39d', fontSize: 7, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 }, emptyText: { color: '#89948e', fontSize: 10, textAlign: 'center' }, offlineNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13, backgroundColor: '#fff6e7', padding: 11, borderRadius: 12 }, offlineText: { color: '#8d764c', flex: 1, fontSize: 9, lineHeight: 14 }, reload: { height: 43, backgroundColor: '#138e71', borderRadius: 12, marginTop: 12, flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center' }, reloadText: { color: '#fff', fontSize: 10, fontWeight: '800' },
})
