import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

// Shared constants and hooks are exported alongside the provider by design.
// eslint-disable-next-line react/only-export-components
export const languages = [
  { code: 'en', name: 'English' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'so', name: 'Soomaali' },
  { code: 'am', name: 'አማርኛ' },
  { code: 'pt', name: 'Português' },
] as const
export type LanguageCode = typeof languages[number]['code']

const common: Record<string, Partial<Record<LanguageCode, string>>> = {
  'BUSINESS SUITE': { sw: 'HUDUMA ZA BIASHARA', fr: 'SUITE COMMERCIALE', ar: 'مجموعة الأعمال', so: 'ADEEGYADA GANACSIGA', am: 'የንግድ ስብስብ', pt: 'SUÍTE EMPRESARIAL' },
  WORKSPACE: { sw: 'MAHALI PA KAZI', fr: 'ESPACE DE TRAVAIL', ar: 'مساحة العمل', so: 'GOOBTA SHAQADA', am: 'የሥራ ቦታ', pt: 'ESPAÇO DE TRABALHO' },
  MANAGE: { sw: 'SIMAMIA', fr: 'GÉRER', ar: 'الإدارة', so: 'MAAMUL', am: 'አስተዳድር', pt: 'GERENCIAR' },
  'INSIGHTS & COMPLIANCE': { sw: 'TAARIFA NA UZINGATIAJI', fr: 'ANALYSES ET CONFORMITÉ', ar: 'الرؤى والامتثال', so: 'FALANQAYN IYO U HOGGAANSANAAN', am: 'ግንዛቤዎች እና ተገዢነት', pt: 'ANÁLISES E CONFORMIDADE' },
  'Add business': { sw: 'Ongeza biashara', fr: 'Ajouter une entreprise', ar: 'إضافة نشاط تجاري', so: 'Ku dar ganacsi', am: 'ንግድ ጨምር', pt: 'Adicionar empresa' },
  'Saved transactions': { sw: 'Miamala iliyohifadhiwa', fr: 'Opérations enregistrées', ar: 'المعاملات المحفوظة', so: 'Macaamilada kaydsan', am: 'የተቀመጡ ግብይቶች', pt: 'Transações salvas' },
  'Income this month': { sw: 'Mapato mwezi huu', fr: 'Revenus ce mois-ci', ar: 'الدخل هذا الشهر', so: 'Dakhliga bishan', am: 'የዚህ ወር ገቢ', pt: 'Receita deste mês' },
  'Expenses this month': { sw: 'Gharama mwezi huu', fr: 'Dépenses ce mois-ci', ar: 'المصروفات هذا الشهر', so: 'Kharashka bishan', am: 'የዚህ ወር ወጪ', pt: 'Despesas deste mês' },
  'Net movement': { sw: 'Mabadiliko halisi', fr: 'Mouvement net', ar: 'صافي الحركة', so: 'Isbeddelka saafiga ah', am: 'የተጣራ ለውጥ', pt: 'Movimento líquido' },
  'Unpaid invoices': { sw: 'Ankara ambazo hazijalipwa', fr: 'Factures impayées', ar: 'الفواتير غير المدفوعة', so: 'Qaansheegadaha aan la bixin', am: 'ያልተከፈሉ ደረሰኞች', pt: 'Faturas não pagas' },
  'View related records': { sw: 'Tazama rekodi zinazohusiana', fr: 'Voir les enregistrements associés', ar: 'عرض السجلات ذات الصلة', so: 'Eeg diiwaannada la xiriira', am: 'ተዛማጅ መዝገቦችን ይመልከቱ', pt: 'Ver registros relacionados' },
  Language: { sw: 'Lugha', fr: 'Langue', ar: 'اللغة', so: 'Luqadda', am: 'ቋንቋ', pt: 'Idioma' },
  'Business settings': { sw: 'Mipangilio ya biashara', fr: 'Paramètres de l’entreprise', ar: 'إعدادات النشاط التجاري', so: 'Dejinta ganacsiga', am: 'የንግድ ቅንብሮች', pt: 'Configurações da empresa' },
  'Customer order requests': { sw: 'Maombi ya maagizo ya wateja', fr: 'Demandes de commande clients', ar: 'طلبات العملاء', so: 'Codsiyada dalabka macaamiisha', am: 'የደንበኛ ትዕዛዝ ጥያቄዎች', pt: 'Solicitações de pedidos' },
  'Store is open to customers': { sw: 'Duka limefunguliwa kwa wateja', fr: 'La boutique est ouverte aux clients', ar: 'المتجر مفتوح للعملاء', so: 'Dukaanku wuxuu u furan yahay macaamiisha', am: 'መደብሩ ለደንበኞች ክፍት ነው', pt: 'Loja aberta para clientes' },
  'Store address slug': { sw: 'Anwani fupi ya duka', fr: 'Adresse abrégée de la boutique', ar: 'عنوان المتجر المختصر', so: 'Cinwaanka gaaban ee dukaanka', am: 'የመደብር አጭር አድራሻ', pt: 'Endereço curto da loja' },
  'Store name': { sw: 'Jina la duka', fr: 'Nom de la boutique', ar: 'اسم المتجر', so: 'Magaca dukaanka', am: 'የመደብር ስም', pt: 'Nome da loja' },
  'Save store': { sw: 'Hifadhi duka', fr: 'Enregistrer la boutique', ar: 'حفظ المتجر', so: 'Kaydi dukaanka', am: 'መደብሩን አስቀምጥ', pt: 'Salvar loja' },
  'Preview customer store': { sw: 'Hakiki duka la mteja', fr: 'Aperçu de la boutique client', ar: 'معاينة متجر العملاء', so: 'Eeg dukaanka macaamiisha', am: 'የደንበኛ መደብርን ቅድመ እይታ', pt: 'Visualizar loja do cliente' },
  'WooCommerce': { sw: 'WooCommerce', fr: 'WooCommerce', ar: 'WooCommerce', so: 'WooCommerce', am: 'WooCommerce', pt: 'WooCommerce' },
  'Save encrypted connection': { sw: 'Hifadhi muunganisho uliosimbwa', fr: 'Enregistrer la connexion chiffrée', ar: 'حفظ الاتصال المشفر', so: 'Kaydi xiriirka siraysan', am: 'የተመሰጠረ ግንኙነት አስቀምጥ', pt: 'Salvar conexão criptografada' },
  'Sync products': { sw: 'Sawazisha bidhaa', fr: 'Synchroniser les produits', ar: 'مزامنة المنتجات', so: 'Isku waafaji alaabta', am: 'ምርቶችን አመሳስል', pt: 'Sincronizar produtos' },
  'Import new orders': { sw: 'Leta maagizo mapya', fr: 'Importer les nouvelles commandes', ar: 'استيراد الطلبات الجديدة', so: 'Soo geli dalabyo cusub', am: 'አዲስ ትዕዛዞችን አስገባ', pt: 'Importar novos pedidos' },
  'Team permissions': { sw: 'Ruhusa za timu', fr: 'Autorisations de l’équipe', ar: 'أذونات الفريق', so: 'Oggolaanshaha kooxda', am: 'የቡድን ፈቃዶች', pt: 'Permissões da equipe' },
  'Save permissions': { sw: 'Hifadhi ruhusa', fr: 'Enregistrer les autorisations', ar: 'حفظ الأذونات', so: 'Kaydi oggolaanshaha', am: 'ፈቃዶችን አስቀምጥ', pt: 'Salvar permissões' },
  Accept: { sw: 'Kubali', fr: 'Accepter', ar: 'قبول', so: 'Aqbal', am: 'ተቀበል', pt: 'Aceitar' },
  Reject: { sw: 'Kataa', fr: 'Refuser', ar: 'رفض', so: 'Diid', am: 'እምቢ በል', pt: 'Rejeitar' },
  'Convert to invoice': { sw: 'Badilisha kuwa ankara', fr: 'Convertir en facture', ar: 'تحويل إلى فاتورة', so: 'U beddel qaansheegad', am: 'ወደ ደረሰኝ ቀይር', pt: 'Converter em fatura' },
  'Mark fulfilled': { sw: 'Weka alama kuwa imetimizwa', fr: 'Marquer comme exécutée', ar: 'تحديد كمكتمل', so: 'Ku calaamadee in la dhammaystiray', am: 'እንደተፈጸመ ምልክት አድርግ', pt: 'Marcar como atendido' },
  'Thermal print': { sw: 'Chapisha kwa joto', fr: 'Impression thermique', ar: 'طباعة حرارية', so: 'Daabac kuleyl', am: 'በቴርማል አትም', pt: 'Impressão térmica' },
  'Open cash drawer': { sw: 'Fungua droo ya pesa', fr: 'Ouvrir le tiroir-caisse', ar: 'افتح درج النقود', so: 'Fur khaanadda lacagta', am: 'የገንዘብ መሳቢያውን ክፈት', pt: 'Abrir gaveta de dinheiro' },
  'Test connection': { sw: 'Jaribu muunganisho', fr: 'Tester la connexion', ar: 'اختبار الاتصال', so: 'Tijaabi xiriirka', am: 'ግንኙነቱን ሞክር', pt: 'Testar conexão' },
  'Print receipt': { sw: 'Chapisha risiti', fr: 'Imprimer le reçu', ar: 'طباعة الإيصال', so: 'Daabac rasiidka', am: 'ደረሰኙን አትም', pt: 'Imprimir recibo' },
  'Receipt sent to the thermal printer.': { sw: 'Risiti imetumwa kwa printa ya joto.', fr: 'Reçu envoyé à l’imprimante thermique.', ar: 'تم إرسال الإيصال إلى الطابعة الحرارية.', so: 'Rasiidka waxaa loo diray daabacaha kuleylka.', am: 'ደረሰኙ ወደ ቴርማል ማተሚያ ተልኳል።', pt: 'Recibo enviado para a impressora térmica.' },
  'Internal receipt only; not an eTIMS tax invoice.': { sw: 'Risiti ya ndani tu; si ankara ya kodi ya eTIMS.', fr: 'Reçu interne uniquement, pas une facture fiscale eTIMS.', ar: 'إيصال داخلي فقط، وليس فاتورة ضريبية من eTIMS.', so: 'Rasiid gudaha ah oo keliya; ma aha qaansheegad cashuureed eTIMS.', am: 'የውስጥ ደረሰኝ ብቻ ነው፤ የeTIMS የግብር ደረሰኝ አይደለም።', pt: 'Recibo interno, não é uma fatura fiscal eTIMS.' },
  'Private workspace': { sw: 'Nafasi ya kazi ya faragha', fr: 'Espace de travail privé', ar: 'مساحة عمل خاصة', so: 'Goob shaqo oo gaar ah', am: 'የግል የሥራ ቦታ', pt: 'Espaço de trabalho privado' },
  'Records you enter are saved to your account database.': { sw: 'Rekodi unazoingiza huhifadhiwa kwenye hifadhidata ya akaunti yako.', fr: 'Les données saisies sont enregistrées dans la base de données de votre compte.', ar: 'يتم حفظ السجلات التي تدخلها في قاعدة بيانات حسابك.', so: 'Diiwaannada aad geliso waxaa lagu kaydiyaa kaydka xogta akoonkaaga.', am: 'ያስገቧቸው መዝገቦች በመለያዎ ዳታቤዝ ውስጥ ይቀመጣሉ።', pt: 'Os registros inseridos são salvos no banco de dados da sua conta.' },
  'Point of sale': { sw: 'Sehemu ya mauzo', fr: 'Point de vente', ar: 'نقطة البيع', so: 'Goobta iibka', am: 'የሽያጭ ቦታ', pt: 'Ponto de venda' },
  'Counter checkout': { sw: 'Malipo ya kaunta', fr: 'Encaissement au comptoir', ar: 'الدفع عند نقطة البيع', so: 'Lacag-bixinta miiska', am: 'የመቆጣጠሪያ ክፍያ', pt: 'Caixa do balcão' },
  'Online store': { sw: 'Duka la mtandaoni', fr: 'Boutique en ligne', ar: 'المتجر الإلكتروني', so: 'Dukaan internet', am: 'የመስመር ላይ መደብር', pt: 'Loja online' },
  'Online store and customer orders': { sw: 'Duka la mtandaoni na maagizo ya wateja', fr: 'Boutique en ligne et commandes clients', ar: 'المتجر الإلكتروني وطلبات العملاء', so: 'Dukaanka internetka iyo dalabaadka macaamiisha', am: 'የመስመር ላይ መደብር እና የደንበኛ ትዕዛዞች', pt: 'Loja online e pedidos de clientes' },
  'Your order request': { sw: 'Ombi lako la agizo', fr: 'Votre demande de commande', ar: 'طلبك', so: 'Codsiga dalabkaaga', am: 'የትዕዛዝ ጥያቄዎ', pt: 'Seu pedido' },
  'Order request received': { sw: 'Ombi la agizo limepokelewa', fr: 'Demande de commande reçue', ar: 'تم استلام طلبك', so: 'Codsiga dalabka waa la helay', am: 'የትዕዛዝ ጥያቄው ደርሷል', pt: 'Pedido recebido' },
  'Store unavailable': { sw: 'Duka halipatikani', fr: 'Boutique indisponible', ar: 'المتجر غير متاح', so: 'Dukaanka lama heli karo', am: 'መደብሩ አይገኝም', pt: 'Loja indisponível' },
  'ONLINE STORE': { sw: 'DUKA LA MTANDAONI', fr: 'BOUTIQUE EN LIGNE', ar: 'المتجر الإلكتروني', so: 'DUKAAN INTERNET', am: 'የመስመር ላይ መደብር', pt: 'LOJA ONLINE' },
  Products: { sw: 'Bidhaa', fr: 'Produits', ar: 'المنتجات', so: 'Alaabooyinka', am: 'ምርቶች', pt: 'Produtos' },
  'Available to request': { sw: 'Inapatikana kuagiza', fr: 'Disponible sur demande', ar: 'متاح للطلب', so: 'Waa la codsan karaa', am: 'ለመጠየቅ ይገኛል', pt: 'Disponível para solicitar' },
  'Currently unavailable': { sw: 'Haipatikani kwa sasa', fr: 'Actuellement indisponible', ar: 'غير متاح حاليًا', so: 'Hadda lama heli karo', am: 'በአሁኑ ጊዜ አይገኝም', pt: 'Indisponível no momento' },
  'Decrease quantity': { sw: 'Punguza idadi', fr: 'Diminuer la quantité', ar: 'تقليل الكمية', so: 'Yaree tirada', am: 'ብዛቱን ቀንስ', pt: 'Diminuir quantidade' },
  'Increase quantity': { sw: 'Ongeza idadi', fr: 'Augmenter la quantité', ar: 'زيادة الكمية', so: 'Kordhi tirada', am: 'ብዛቱን ጨምር', pt: 'Aumentar quantidade' },
  Remove: { sw: 'Ondoa', fr: 'Retirer', ar: 'إزالة', so: 'Ka saar', am: 'አስወግድ', pt: 'Remover' },
  'Add to order': { sw: 'Ongeza kwenye agizo', fr: 'Ajouter à la commande', ar: 'أضف إلى الطلب', so: 'Ku dar dalabka', am: 'ወደ ትዕዛዝ ጨምር', pt: 'Adicionar ao pedido' },
  'There are no products currently listed for sale.': { sw: 'Hakuna bidhaa zilizoorodheshwa kwa mauzo kwa sasa.', fr: 'Aucun produit n’est actuellement proposé à la vente.', ar: 'لا توجد منتجات معروضة للبيع حاليًا.', so: 'Hadda ma jiraan alaabo iib ah oo liiska ku jira.', am: 'በአሁኑ ጊዜ ለሽያጭ የተዘረዘሩ ምርቶች የሉም።', pt: 'Não há produtos listados para venda no momento.' },
  'Your order is empty.': { sw: 'Agizo lako halina bidhaa.', fr: 'Votre commande est vide.', ar: 'طلبك فارغ.', so: 'Dalabkaagu waa madhan yahay.', am: 'ትዕዛዝዎ ባዶ ነው።', pt: 'Seu pedido está vazio.' },
  'This submits an order request, not an online payment. The seller must confirm stock, delivery charges, any applicable tax, and payment arrangements. Listed prices exclude shipping and tax.': { sw: 'Hii hutuma ombi la agizo, si malipo ya mtandaoni. Muuzaji lazima athibitishe bidhaa, gharama za usafirishaji, kodi husika na mipango ya malipo. Bei hazijumuishi usafirishaji wala kodi.', fr: 'Ceci envoie une demande, pas un paiement en ligne. Le vendeur doit confirmer le stock, la livraison, les taxes applicables et le paiement. Les prix excluent livraison et taxes.', ar: 'هذا يرسل طلبًا وليس دفعًا عبر الإنترنت. يجب على البائع تأكيد المخزون والتوصيل والضرائب وترتيبات الدفع. الأسعار لا تشمل الشحن والضرائب.', so: 'Tani waxay diraysaa codsi dalab, ma aha lacag-bixin internet. Iibiyuhu waa inuu xaqiijiyaa alaabta, gaarsiinta, canshuurta iyo bixinta. Qiimuhu kuma jiraan gaarsiin iyo canshuur.', am: 'ይህ የትዕዛዝ ጥያቄ ይልካል እንጂ የመስመር ላይ ክፍያ አይደለም። ሻጩ እቃ፣ ማድረሻ፣ ግብር እና ክፍያን ማረጋገጥ አለበት። ዋጋዎች ማድረሻንና ግብርን አያካትቱም።', pt: 'Isto envia uma solicitação, não um pagamento online. O vendedor deve confirmar estoque, entrega, impostos aplicáveis e pagamento. Os preços não incluem frete nem impostos.' },
  'Order and tracking details are private to the customer holding the secure tracking link. KashFlow does not collect online payment or file tax invoices from this page.': { sw: 'Maelezo ya agizo ni ya faragha kwa mteja mwenye kiungo salama cha ufuatiliaji. KashFlow haikusanyi malipo ya mtandaoni wala kuwasilisha ankara za kodi kutoka ukurasa huu.', fr: 'Les détails de commande sont réservés au client détenteur du lien sécurisé. KashFlow ne collecte pas de paiement en ligne et ne dépose pas de facture fiscale depuis cette page.', ar: 'تفاصيل الطلب خاصة بالعميل الذي يملك رابط التتبع الآمن. لا يجمع KashFlow مدفوعات عبر الإنترنت ولا يقدم فواتير ضريبية من هذه الصفحة.', so: 'Faahfaahinta dalabku waa u gaar macaamilka haysta xiriirka ammaan ah. KashFlow kama ururiyo lacag internetka mana gudbiyo qaansheegad canshuureed boggan.', am: 'የትዕዛዝ ዝርዝሮች ደህንነቱ የተጠበቀውን አገናኝ ለያዘ ደንበኛ ብቻ ናቸው። KashFlow ከዚህ ገጽ የመስመር ላይ ክፍያ አይቀበልም ወይም የግብር ደረሰኝ አያስገባም።', pt: 'Os detalhes do pedido são privados ao cliente com o link seguro. O KashFlow não recebe pagamentos online nem emite faturas fiscais nesta página.' },
  'pending_review': { sw: 'inasubiri ukaguzi', fr: 'en attente de vérification', ar: 'قيد المراجعة', so: 'dib-u-eegis sugaya', am: 'ግምገማ በመጠባበቅ ላይ', pt: 'aguardando revisão' },
  accepted: { sw: 'imekubaliwa', fr: 'acceptée', ar: 'مقبول', so: 'la aqbalay', am: 'ተቀባይነት አግኝቷል', pt: 'aceito' },
  rejected: { sw: 'imekataliwa', fr: 'refusée', ar: 'مرفوض', so: 'la diiday', am: 'ውድቅ ተደርጓል', pt: 'rejeitado' },
  invoiced: { sw: 'imewekewa ankara', fr: 'facturée', ar: 'تم إصدار فاتورة', so: 'qaansheegad loo sameeyay', am: 'ደረሰኝ ተዘጋጅቶለታል', pt: 'faturado' },
  fulfilled: { sw: 'imetimizwa', fr: 'exécutée', ar: 'مكتمل', so: 'la dhammaystiray', am: 'ተፈጽሟል', pt: 'atendido' },
  'Could not load order status.': { sw: 'Haikuwezekana kupakia hali ya agizo.', fr: 'Impossible de charger le statut de commande.', ar: 'تعذر تحميل حالة الطلب.', so: 'Lama soo rari karin xaaladda dalabka.', am: 'የትዕዛዝ ሁኔታን መጫን አልተቻለም።', pt: 'Não foi possível carregar o status do pedido.' },
  'Your name': { sw: 'Jina lako', fr: 'Votre nom', ar: 'اسمك', so: 'Magacaaga', am: 'ስምዎ', pt: 'Seu nome' },
  Email: { sw: 'Barua pepe', fr: 'E-mail', ar: 'البريد الإلكتروني', so: 'Iimaylka', am: 'ኢሜይል', pt: 'E-mail' },
  'Phone (optional)': { sw: 'Simu (si lazima)', fr: 'Téléphone (facultatif)', ar: 'الهاتف (اختياري)', so: 'Telefoon (ikhtiyaari)', am: 'ስልክ (አማራጭ)', pt: 'Telefone (opcional)' },
  'Submit order request': { sw: 'Tuma ombi la agizo', fr: 'Envoyer la demande', ar: 'إرسال الطلب', so: 'Dir codsiga dalabka', am: 'የትዕዛዝ ጥያቄ ላክ', pt: 'Enviar pedido' },
  'Track your order': { sw: 'Fuatilia agizo lako', fr: 'Suivre votre commande', ar: 'تتبع طلبك', so: 'La soco dalabkaaga', am: 'ትዕዛዝዎን ይከታተሉ', pt: 'Acompanhar pedido' },
  'CUSTOMER ORDER TRACKING': { sw: 'UFUATILIAJI WA AGIZO LA MTEJA', fr: 'SUIVI DE COMMANDE CLIENT', ar: 'تتبع طلب العميل', so: 'RAACRAACA DALABKA MACMIILKA', am: 'የደንበኛ ትዕዛዝ ክትትል', pt: 'RASTREAMENTO DO PEDIDO' },
  'Your order': { sw: 'Agizo lako', fr: 'Votre commande', ar: 'طلبك', so: 'Dalabkaaga', am: 'ትዕዛዝዎ', pt: 'Seu pedido' },
  'Loading order…': { sw: 'Agizo linapakia…', fr: 'Chargement de la commande…', ar: 'جارٍ تحميل الطلب…', so: 'Dalabka ayaa la soo rarayaa…', am: 'ትዕዛዙ በመጫን ላይ…', pt: 'Carregando pedido…' },
  Subtotal: { sw: 'Jumla ndogo', fr: 'Sous-total', ar: 'المجموع الفرعي', so: 'Wadarta qayb ahaan', am: 'ንዑስ ድምር', pt: 'Subtotal' },
  'SALE RECEIPT': { sw: 'RISITI YA MAUZO', fr: 'REÇU DE VENTE', ar: 'إيصال بيع', so: 'RASIIDKA IIBKA', am: 'የሽያጭ ደረሰኝ', pt: 'RECIBO DE VENDA' },
  Invoice: { sw: 'Ankara', fr: 'Facture', ar: 'فاتورة', so: 'Qaansheegad', am: 'ደረሰኝ', pt: 'Fatura' },
  Customer: { sw: 'Mteja', fr: 'Client', ar: 'العميل', so: 'Macmiil', am: 'ደንበኛ', pt: 'Cliente' },
  Total: { sw: 'Jumla', fr: 'Total', ar: 'الإجمالي', so: 'Wadar', am: 'ጠቅላላ', pt: 'Total' },
  Open: { sw: 'Fungua', fr: 'Ouvrir', ar: 'فتح', so: 'Fur', am: 'ክፈት', pt: 'Abrir' },
  details: { sw: 'maelezo', fr: 'détails', ar: 'التفاصيل', so: 'faahfaahinta', am: 'ዝርዝሮች', pt: 'detalhes' },
  Overview: { sw: 'Muhtasari', fr: 'Aperçu', ar: 'نظرة عامة', so: 'Guudmar', am: 'አጠቃላይ እይታ', pt: 'Visão geral' },
  Banking: { sw: 'Benki', fr: 'Banque', ar: 'الخدمات المصرفية', so: 'Bangiyada', am: 'ባንክ', pt: 'Bancos' },
  Sales: { sw: 'Mauzo', fr: 'Ventes', ar: 'المبيعات', so: 'Iibka', am: 'ሽያጭ', pt: 'Vendas' },
  Expenses: { sw: 'Gharama', fr: 'Dépenses', ar: 'المصروفات', so: 'Kharashyada', am: 'ወጪዎች', pt: 'Despesas' },
  Payroll: { sw: 'Malipo ya wafanyakazi', fr: 'Paie', ar: 'كشوف الرواتب', so: 'Mushaharka', am: 'የደመወዝ ክፍያ', pt: 'Folha de pagamento' },
  Customers: { sw: 'Wateja', fr: 'Clients', ar: 'العملاء', so: 'Macaamiisha', am: 'ደንበኞች', pt: 'Clientes' },
  Suppliers: { sw: 'Wasambazaji', fr: 'Fournisseurs', ar: 'الموردون', so: 'Alaab-qeybiyeyaasha', am: 'አቅራቢዎች', pt: 'Fornecedores' },
  Inventory: { sw: 'Hesabu ya bidhaa', fr: 'Stock', ar: 'المخزون', so: 'Alaabada', am: 'የእቃ ዝርዝር', pt: 'Estoque' },
  Projects: { sw: 'Miradi', fr: 'Projets', ar: 'المشاريع', so: 'Mashaariicda', am: 'ፕሮጀክቶች', pt: 'Projetos' },
  Accounting: { sw: 'Uhasibu', fr: 'Comptabilité', ar: 'المحاسبة', so: 'Xisaabaadka', am: 'ሂሳብ አያያዝ', pt: 'Contabilidade' },
  Reports: { sw: 'Ripoti', fr: 'Rapports', ar: 'التقارير', so: 'Warbixinno', am: 'ሪፖርቶች', pt: 'Relatórios' },
  'Kenya compliance': { sw: 'Uzingatiaji wa Kenya', fr: 'Conformité au Kenya', ar: 'الامتثال في كينيا', so: 'U hoggaansanaanta Kenya', am: 'የኬንያ ተገዢነት', pt: 'Conformidade do Quênia' },
  Documents: { sw: 'Nyaraka', fr: 'Documents', ar: 'المستندات', so: 'Dukumentiyada', am: 'ሰነዶች', pt: 'Documentos' },
  Settings: { sw: 'Mipangilio', fr: 'Paramètres', ar: 'الإعدادات', so: 'Dejinta', am: 'ቅንብሮች', pt: 'Configurações' },
  'Help & support': { sw: 'Msaada na usaidizi', fr: 'Aide et assistance', ar: 'المساعدة والدعم', so: 'Caawimaad iyo taageero', am: 'እገዛ እና ድጋፍ', pt: 'Ajuda e suporte' },
  Help: { sw: 'Msaada', fr: 'Aide', ar: 'المساعدة', so: 'Caawimaad', am: 'እገዛ', pt: 'Ajuda' },
  'Add transaction': { sw: 'Ongeza muamala', fr: 'Ajouter une opération', ar: 'إضافة معاملة', so: 'Ku dar macaamil', am: 'ግብይት ጨምር', pt: 'Adicionar transação' },
  'Create invoice': { sw: 'Unda ankara', fr: 'Créer une facture', ar: 'إنشاء فاتورة', so: 'Samee qaansheegad', am: 'ደረሰኝ ፍጠር', pt: 'Criar fatura' },
  'Invite member': { sw: 'Alika mwanachama', fr: 'Inviter un membre', ar: 'دعوة عضو', so: 'Ku casuun xubin', am: 'አባል ጋብዝ', pt: 'Convidar membro' },
  'Business reports': { sw: 'Ripoti za biashara', fr: 'Rapports commerciaux', ar: 'تقارير الأعمال', so: 'Warbixinnada ganacsiga', am: 'የንግድ ሪፖርቶች', pt: 'Relatórios empresariais' },
  'Order unavailable': { sw: 'Agizo halipatikani', fr: 'Commande indisponible', ar: 'الطلب غير متاح', so: 'Dalabka lama heli karo', am: 'ትዕዛዙ አይገኝም', pt: 'Pedido indisponível' },
  'Loading store…': { sw: 'Duka linapakia…', fr: 'Chargement de la boutique…', ar: 'جارٍ تحميل المتجر…', so: 'Dukaanka ayaa furmaya…', am: 'መደብሩ በመጫን ላይ…', pt: 'Carregando loja…' },
  'Order tracking link is invalid.': { sw: 'Kiungo cha kufuatilia agizo si sahihi.', fr: 'Le lien de suivi est invalide.', ar: 'رابط تتبع الطلب غير صالح.', so: 'Xiriirka raadraaca dalabku sax ma aha.', am: 'የትዕዛዝ መከታተያ አገናኝ ልክ አይደለም።', pt: 'O link de rastreamento é inválido.' },
}

type LanguageContextValue = { language: LanguageCode; setLanguage: (language: LanguageCode) => void; t: (phrase: string) => string }
const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setCurrentLanguage] = useState<LanguageCode>(() => {
    const saved = localStorage.getItem('kashflow-language')
    return languages.some((entry) => entry.code === saved) ? saved as LanguageCode : 'en'
  })
  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage(next) {
      localStorage.setItem('kashflow-language', next)
      setCurrentLanguage(next)
    },
    t(phrase) {
      return language === 'en' ? phrase : common[phrase]?.[language] ?? phrase
    },
  }), [language])

  useEffect(() => {
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  }, [language])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// eslint-disable-next-line react/only-export-components
export function useTranslation() {
  const context = useContext(LanguageContext)
  if (!context) throw new Error('useTranslation must be used inside LanguageProvider.')
  return context
}
