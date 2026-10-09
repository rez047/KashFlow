import { Ionicons } from '@expo/vector-icons'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { createLocalCountKey, queueCount, updateCount } from '../../src/lib/offline'
import { useKashFlow } from './_layout'

function nairobiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default function CountScreen() {
  const { online, snapshot, syncNow, reloadLocal } = useKashFlow()
  const params = useLocalSearchParams<{ itemId?: string; locationId?: string; supersedes?: string }>()
  const [query, setQuery] = useState('')
  const [itemId, setItemId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const selectedItem = snapshot?.items.find((item) => item.id === itemId)
  const locations = snapshot?.locations.filter((location) => location.active) ?? []
  const effectiveLocationId = locationId || locations.find((location) => location.is_default)?.id || locations[0]?.id || ''
  const currentQuantity = Number(snapshot?.stock.find((stock) => stock.item_id === itemId && stock.location_id === effectiveLocationId)?.quantity ?? 0)
  const matches = useMemo(() => (snapshot?.items ?? []).filter((item) => {
    const q = query.trim().toLowerCase()
    return !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
  }).slice(0, 6), [query, snapshot?.items])
  const numericQuantity = Number(quantity)
  const valid = Boolean(snapshot && itemId && effectiveLocationId && quantity.trim() !== '' && Number.isFinite(numericQuantity) && numericQuantity >= 0 && numericQuantity <= 1_000_000)

  useEffect(() => {
    if (params.itemId && snapshot?.items.some((item) => item.id === params.itemId)) {
      setItemId(params.itemId)
      setQuery(snapshot.items.find((item) => item.id === params.itemId)?.name ?? '')
    }
    if (params.locationId && snapshot?.locations.some((location) => location.id === params.locationId)) setLocationId(params.locationId)
  }, [params.itemId, params.locationId, snapshot])

  async function saveCount() {
    if (!valid || !snapshot) return
    Keyboard.dismiss()
    setSaving(true)
    try {
      await queueCount({ idempotencyKey: await createLocalCountKey(), itemId, locationId: effectiveLocationId, countedQuantity: Number(numericQuantity.toFixed(3)), expectedQuantity: currentQuantity, date: nairobiToday(), reference: reference.trim().slice(0, 200) })
      if (params.supersedes) await updateCount(params.supersedes, 'superseded', 'Replaced by a new physical count after stock changed.')
      await reloadLocal()
      setQuantity(''); setReference(''); setQuery(''); setItemId('')
      if (params.supersedes) router.setParams({ itemId: undefined, locationId: undefined, supersedes: undefined })
      Alert.alert('Count saved', online ? 'It is encrypted on this device and ready to sync.' : 'It is encrypted on this device. It will stay here until you reconnect.', online ? [{ text: 'Later', style: 'cancel' }, { text: 'Sync now', onPress: () => { void syncNow() } }] : [{ text: 'Keep counting' }])
    } catch (error) {
      Alert.alert('Could not save count', error instanceof Error ? error.message : 'Make some space on the device and try again.')
    } finally { setSaving(false) }
  }

  return <View style={styles.screen}><ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
    <View style={styles.top}><View><Text style={styles.eyebrow}>INVENTORY CONTROL</Text><Text style={styles.title}>Count a shelf</Text></View><View style={[styles.mode, online ? styles.modeOnline : styles.modeOffline]}><View style={[styles.modeDot, online ? styles.modeDotOnline : styles.modeDotOffline]} /><Text style={[styles.modeText, online ? styles.modeTextOnline : styles.modeTextOffline]}>{online ? 'ONLINE' : 'OFFLINE'}</Text></View></View>
    <Text style={styles.subtitle}>Take a physical count anywhere. Your work is saved locally first.</Text>

    <View style={styles.stepLine}><View style={styles.step}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>01</Text></View><Text style={styles.stepLabel}>CHOOSE ITEM</Text></View><View style={styles.stepConnector} /><View style={styles.step}><View style={[styles.stepNumber, itemId && styles.stepDone]}><Text style={[styles.stepNumberText, itemId && styles.stepDoneText]}>{itemId ? '✓' : '02'}</Text></View><Text style={styles.stepLabel}>COUNT</Text></View><View style={styles.stepConnector} /><View style={styles.step}><View style={[styles.stepNumber, quantity && styles.stepDone]}><Text style={[styles.stepNumberText, quantity && styles.stepDoneText]}>{quantity ? '✓' : '03'}</Text></View><Text style={styles.stepLabel}>SAVE</Text></View></View>

    {!snapshot ? <View style={styles.empty}><View style={styles.emptyMark}><Ionicons name="cloud-download-outline" size={22} color="#128b70" /></View><Text style={styles.emptyTitle}>Load your items first</Text><Text style={styles.emptyBody}>Connect once to cache your item list and stock locations. After that, you can count even with no signal.</Text></View> : <>
      <Text style={styles.sectionLabel}>1 · SELECT PRODUCT</Text>
      {selectedItem ? <View style={styles.selectedCard}><View style={styles.selectedIcon}><Ionicons name="cube-outline" size={20} color="#138b70" /></View><View style={styles.selectedCopy}><Text numberOfLines={1} style={styles.selectedName}>{selectedItem.name}</Text><Text style={styles.selectedMeta}>{selectedItem.sku ? `SKU ${selectedItem.sku}` : selectedItem.category || 'Inventory item'}</Text></View><Pressable accessibilityLabel="Choose a different item" style={styles.changeButton} onPress={() => { setItemId(''); setQuery('') }}><Text style={styles.changeText}>Change</Text></Pressable></View> : <>
        <View style={styles.search}><Ionicons name="search-outline" size={16} color="#929d97" /><TextInput value={query} onChangeText={setQuery} placeholder="Search by name or scan SKU" placeholderTextColor="#a4ada7" style={styles.searchInput} autoCorrect={false} /></View>
        <View style={styles.matches}>{matches.slice(0, query ? 6 : 3).map((item) => <Pressable key={item.id} onPress={() => { setItemId(item.id); setQuery(item.name) }} style={styles.match}><View style={styles.matchMark}><Text style={styles.matchInitial}>{item.name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.matchCopy}><Text numberOfLines={1} style={styles.matchName}>{item.name}</Text><Text style={styles.matchMeta}>{item.sku ? `SKU ${item.sku}` : item.category || 'Inventory item'}</Text></View><Ionicons name="chevron-forward" size={16} color="#9ba59f" /></Pressable>)}{matches.length === 0 && <Text style={styles.noMatches}>No matching item in the saved catalog.</Text>}</View>
      </>}

      {itemId && <>
        <Text style={[styles.sectionLabel, styles.sectionGap]}>2 · SELECT LOCATION</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locationChips}>{locations.map((location) => <Pressable key={location.id} onPress={() => setLocationId(location.id)} style={[styles.locationChip, effectiveLocationId === location.id && styles.locationChipActive]}><Ionicons name={location.is_default ? 'storefront-outline' : 'business-outline'} size={13} color={effectiveLocationId === location.id ? '#fff' : '#71817b'} /><Text style={[styles.locationText, effectiveLocationId === location.id && styles.locationTextActive]}>{location.name}</Text></Pressable>)}</ScrollView>
        <View style={styles.quantityHeader}><View><Text style={styles.sectionLabel}>3 · ENTER PHYSICAL COUNT</Text><Text style={styles.savedHint}>Last saved here: <Text style={styles.savedValue}>{currentQuantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} {selectedItem?.unit || 'units'}</Text></Text></View><View style={styles.baseline}><Text style={styles.baselineLabel}>BASELINE</Text><Text style={styles.baselineQty}>{currentQuantity.toLocaleString(undefined, { maximumFractionDigits: 3 })}</Text></View></View>
        <View style={styles.quantityCard}><Pressable accessibilityLabel="Decrease count" onPress={() => setQuantity(String(Math.max(0, numericQuantity - 1 || 0)))} style={styles.stepper}><Ionicons name="remove" size={20} color="#38544e" /></Pressable><TextInput value={quantity} onChangeText={(value) => setQuantity(value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#b7c0ba" style={styles.quantityInput} selectTextOnFocus /><Pressable accessibilityLabel="Increase count" onPress={() => setQuantity(String((Number(quantity) || 0) + 1))} style={styles.stepper}><Ionicons name="add" size={20} color="#38544e" /></Pressable></View>
        <View style={styles.reference}><Text style={styles.referenceLabel}>NOTE <Text style={styles.optional}>OPTIONAL</Text></Text><TextInput value={reference} onChangeText={setReference} maxLength={200} placeholder="e.g. Morning aisle check" placeholderTextColor="#a4ada7" style={styles.referenceInput} returnKeyType="done" /></View>
        <View style={styles.safetyNote}><Ionicons name="information-circle-outline" size={17} color="#a87937" /><Text style={styles.safetyText}>The server checks that stock has not changed since this baseline. If it has, your count will wait for review.</Text></View>
        <Pressable onPress={() => void saveCount()} disabled={!valid || saving} style={({ pressed }) => [styles.saveButton, (!valid || saving) && styles.saveDisabled, pressed && valid && styles.savePressed]}><Text style={styles.saveText}>{saving ? 'Saving securely…' : online ? 'Save count & sync' : 'Save count on this device'}</Text>{saving ? null : <Ionicons name="arrow-forward" size={17} color="#fff" />}</Pressable>
      </>}
      <View style={styles.bottomNote}><Ionicons name="lock-closed-outline" size={13} color="#8d9992" /><Text style={styles.bottomText}>Count details are encrypted on this device and are never sent until you choose to sync.</Text></View>
    </>}
  </ScrollView></View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f1' }, page: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 28, maxWidth: 650, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#128c72', fontSize: 8, fontWeight: '900', letterSpacing: 1.6 }, title: { color: '#18272d', fontSize: 25, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 }, subtitle: { color: '#84908a', fontSize: 10, lineHeight: 15, marginTop: 6 },
  mode: { height: 27, borderRadius: 15, paddingHorizontal: 9, flexDirection: 'row', gap: 6, alignItems: 'center' }, modeOnline: { backgroundColor: '#e3f2eb' }, modeOffline: { backgroundColor: '#fff0d9' }, modeDot: { width: 6, height: 6, borderRadius: 4 }, modeDotOnline: { backgroundColor: '#1b9f7a' }, modeDotOffline: { backgroundColor: '#bf8131' }, modeText: { fontSize: 7, fontWeight: '900', letterSpacing: 1.1 }, modeTextOnline: { color: '#178268' }, modeTextOffline: { color: '#a5722d' },
  stepLine: { flexDirection: 'row', alignItems: 'center', marginTop: 23, marginBottom: 22 }, step: { flexDirection: 'row', alignItems: 'center', gap: 6 }, stepNumber: { width: 24, height: 24, borderRadius: 9, backgroundColor: '#e7e9e2', alignItems: 'center', justifyContent: 'center' }, stepNumberText: { color: '#73817b', fontSize: 8, fontWeight: '900' }, stepDone: { backgroundColor: '#def1e7' }, stepDoneText: { color: '#128a70' }, stepLabel: { color: '#88938d', fontSize: 7, letterSpacing: 0.8, fontWeight: '900' }, stepConnector: { flex: 1, height: 1, backgroundColor: '#e1e4de', marginHorizontal: 8 },
  sectionLabel: { color: '#7b8982', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 }, search: { height: 46, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8e1', borderRadius: 13, paddingHorizontal: 12, marginTop: 9 }, searchInput: { flex: 1, fontSize: 11, color: '#26363a', height: '100%' }, matches: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e8eae4', paddingHorizontal: 11, marginTop: 8 }, match: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 9 }, matchMark: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#edf3ee', alignItems: 'center', justifyContent: 'center' }, matchInitial: { color: '#597970', fontWeight: '800', fontSize: 10 }, matchCopy: { flex: 1 }, matchName: { color: '#26363a', fontSize: 10, fontWeight: '800' }, matchMeta: { color: '#98a39d', fontSize: 8, marginTop: 3 }, noMatches: { color: '#929d97', fontSize: 10, padding: 14, textAlign: 'center' },
  selectedCard: { height: 58, borderWidth: 1, borderColor: '#dfe9e1', backgroundColor: '#fff', borderRadius: 14, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 10, marginTop: 9 }, selectedIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#e7f4ed', alignItems: 'center', justifyContent: 'center' }, selectedCopy: { flex: 1 }, selectedName: { color: '#213437', fontSize: 10, fontWeight: '800' }, selectedMeta: { color: '#909b95', fontSize: 8, marginTop: 3 }, changeButton: { paddingHorizontal: 9, paddingVertical: 7, backgroundColor: '#f3f5f0', borderRadius: 9 }, changeText: { color: '#13866c', fontSize: 8, fontWeight: '800' },
  sectionGap: { marginTop: 19 }, locationChips: { gap: 7, paddingVertical: 9 }, locationChip: { height: 34, borderRadius: 11, backgroundColor: '#e9ece6', paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 }, locationChipActive: { backgroundColor: '#15353a' }, locationText: { color: '#64746d', fontSize: 8, fontWeight: '800' }, locationTextActive: { color: '#fff' },
  quantityHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }, savedHint: { color: '#9aa39d', fontSize: 8, marginTop: 5 }, savedValue: { color: '#62766d', fontWeight: '800' }, baseline: { alignItems: 'flex-end', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#e9efe9', borderRadius: 10 }, baselineLabel: { color: '#89958d', fontSize: 6, fontWeight: '900', letterSpacing: 1 }, baselineQty: { color: '#3d6155', fontSize: 12, fontWeight: '800', marginTop: 1 },
  quantityCard: { height: 80, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderColor: '#e4e8e0', borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, marginTop: 9 }, stepper: { width: 42, height: 42, backgroundColor: '#edf3ed', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, quantityInput: { flex: 1, textAlign: 'center', color: '#173039', fontSize: 34, fontWeight: '800', height: 68, padding: 0 }, reference: { marginTop: 15 }, referenceLabel: { color: '#7d8a82', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 }, optional: { color: '#abb3ac', fontSize: 7 }, referenceInput: { height: 42, marginTop: 7, borderRadius: 12, borderWidth: 1, borderColor: '#e5e8e1', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 10, color: '#26373a' },
  safetyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 13, backgroundColor: '#fff5e5', borderColor: '#f1e7d4', borderWidth: 1, borderRadius: 12, padding: 10 }, safetyText: { color: '#8b744d', fontSize: 8, lineHeight: 13, flex: 1 }, saveButton: { height: 50, backgroundColor: '#108d71', borderRadius: 14, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, shadowColor: '#0b684f', shadowOpacity: 0.14, shadowRadius: 11, shadowOffset: { width: 0, height: 5 }, elevation: 2 }, saveDisabled: { backgroundColor: '#b8c6bf', shadowOpacity: 0 }, savePressed: { opacity: 0.88 }, saveText: { color: '#fff', fontSize: 10, fontWeight: '900' }, bottomNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 7, marginTop: 15 }, bottomText: { color: '#89958e', fontSize: 8, lineHeight: 13, maxWidth: 300, textAlign: 'center' },
  empty: { marginTop: 20, borderWidth: 1, borderColor: '#e4e8e0', backgroundColor: '#fff', borderRadius: 17, alignItems: 'center', padding: 20 }, emptyMark: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#e7f4ed', alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: '#223538', fontSize: 12, fontWeight: '800', marginTop: 10 }, emptyBody: { color: '#829088', fontSize: 9, lineHeight: 15, textAlign: 'center', marginTop: 6, maxWidth: 270 },
})
