/**
 * i18n — TR / EN translation dictionaries.
 */

import type { AppLanguage } from './settings';

export interface Translations {
  // ── Tabs
  tabHome: string;
  tabMetrics: string;
  tabSdkLogs: string;
  tabSettings: string;

  // ── SDK lifecycle status badge
  statusNotCreated: string;
  statusCreated: string;
  statusParamsSet: string;
  statusInitialized: string;

  // ── Section headings
  sectionSdkLifecycle: string;
  sectionParameters: string;
  sectionLogConsole: string;
  sectionAppearance: string;
  sectionLogRotation: string;
  sectionLogFiles: string;

  // ── Step labels (under step dots)
  stepCreate: string;
  stepSetParams: string;
  stepInit: string;

  // ── Buttons
  btnCreate: string;
  btnDestroy: string;
  btnSetParams: string;
  btnInitSdk: string;
  btnClear: string;
  btnFetch: string;
  btnShowPaths: string;
  btnDeleteAll: string;

  // ── Card titles
  cardLogging: string;
  cardHttp: string;
  cardSip: string;
  cardTls: string;
  cardThreading: string;
  cardTheme: string;
  cardLanguage: string;
  cardMaxFileSize: string;
  cardMaxKeptFiles: string;

  // ── Switch row labels
  switchEnabled: string;
  switchPjEnabled: string;
  switchRxTxEnabled: string;
  switchTcpEnabled: string;
  switchTlsEnabled: string;
  switchIpv6Enabled: string;
  switchMtlsEnabled: string;

  // ── Input row labels
  inputLevel: string;
  inputPjLevel: string;
  inputPort: string;
  inputUdpPort: string;
  inputTcpPort: string;
  inputTlsPort: string;
  inputCertPath: string;
  inputPrivKeyPath: string;
  inputCaListPath: string;
  inputSipRxThreads: string;
  inputSipWorkerThreads: string;

  // ── Log console
  logPlaceholder: string;
  logSdkPlaceholder: string;
  sdkLogHint: (n: number) => string;

  // ── Metrics screen
  metricsHintInitial: string;
  metricsLastFetched: (t: string) => string;
  metricsEmpty: string;
  metricsRawTitle: string;
  metricsNoSdk: string;

  // ── Theme / language option labels
  themeDark: string;
  themeLight: string;
  langTr: string;
  langEn: string;

  // ── Log rotation labels
  fileSizeLabel: (mb: number) => string;
  filesCountLabel: (n: number) => string;

  // ── Settings notes
  settingsFileNote: string;
  logPathsNote: string;

  // ── Alert (delete log files)
  alertDeleteTitle: string;
  alertDeleteMessage: string;
  alertCancel: string;
  alertDelete: string;

  // ── Contacts screen
  tabContacts: string;
  sectionContacts: string;
  inputName: string;
  inputSipUri: string;
  inputNotes: string;
  btnSaveContact: string;
  btnClearContacts: string;
  contactsEmpty: string;
  contactsCount: (n: number) => string;
  contactsAlertClearTitle: string;
  contactsAlertClearMessage: string;
  contactAdded: string;
}

const tr: Translations = {
  tabHome:     'Ana Ekran',
  tabMetrics:  'Metrikler',
  tabSdkLogs:  'SDK Logları',
  tabSettings: 'Ayarlar',

  statusNotCreated:  'OLUŞTURULMADI',
  statusCreated:     'OLUŞTURULDU',
  statusParamsSet:   'PARAMETRE AYARLANDI',
  statusInitialized: 'BAŞLATILDI',

  sectionSdkLifecycle: 'SDK Yaşam Döngüsü',
  sectionParameters:   'Parametreler',
  sectionLogConsole:   'Log Konsolu',
  sectionAppearance:   'Görünüm',
  sectionLogRotation:  'Log Rotasyonu',
  sectionLogFiles:     'Log Dosyaları',

  stepCreate:   'Oluştur',
  stepSetParams: 'Parametre',
  stepInit:     'Başlat',

  btnCreate:    '① Oluştur',
  btnDestroy:   'Yok Et',
  btnSetParams: '② Parametreleri Ayarla',
  btnInitSdk:   '③ SDK\'yı Başlat',
  btnClear:     'Temizle',
  btnFetch:     'Getir',
  btnShowPaths: 'Yolları Göster',
  btnDeleteAll: 'Tümünü Sil',

  cardLogging:      'Loglama',
  cardHttp:         'HTTP',
  cardSip:          'SIP',
  cardTls:          'TLS',
  cardThreading:    'Thread',
  cardTheme:        'Tema',
  cardLanguage:     'Dil',
  cardMaxFileSize:  'Maksimum Dosya Boyutu',
  cardMaxKeptFiles: 'Maksimum Dosya Sayısı',

  switchEnabled:    'Etkin',
  switchPjEnabled:   'PJ Etkin',
  switchRxTxEnabled: 'RxTx Etkin',
  switchTcpEnabled:  'TCP Etkin',
  switchTlsEnabled:  'TLS Etkin',
  switchIpv6Enabled: 'IPv6 Etkin',
  switchMtlsEnabled: 'mTLS Etkin',

  inputLevel:          'Seviye (0-5)',
  inputPjLevel:        'PJ Seviye',
  inputPort:           'Port',
  inputUdpPort:        'UDP Port',
  inputTcpPort:        'TCP Port',
  inputTlsPort:        'TLS Port',
  inputCertPath:       'Sertifika Yolu',
  inputPrivKeyPath:    'Özel Anahtar Yolu',
  inputCaListPath:     'CA Listesi Yolu',
  inputSipRxThreads:   'SIP Rx Thread',
  inputSipWorkerThreads: 'SIP Worker Thread',

  logPlaceholder:    'Loglar burada görünecek…',
  logSdkPlaceholder: 'SDK log olayları burada görünür\nOluştur → Başlat adımlarından sonra.',
  sdkLogHint: n => `${n} kayıt (dosyaya da kaydedildi)`,

  metricsHintInitial:  "Aşağı çek veya 'Getir'e bas",
  metricsLastFetched:  t => `Son güncelleme: ${t}`,
  metricsEmpty:        'Henüz metrik yok.\nAna sekmede SDK\'yı başlat, ardından Getir\'e bas.',
  metricsRawTitle:     'Ham Prometheus Çıktısı',
  metricsNoSdk:        "SDK oluşturulmamış. Ana ekrana git ve 'Oluştur'a bas.",

  themeDark:  '🌙 Koyu',
  themeLight: '☀️ Açık',
  langTr:     '🇹🇷 Türkçe',
  langEn:     '🇬🇧 English',

  fileSizeLabel:   mb => `${mb} MB`,
  filesCountLabel: n  => n === 0 ? 'Sınırsız' : `${n} dosya`,

  settingsFileNote: 'Değişiklikler bir sonraki uygulama yeniden başlatmasında geçerli olur (FileLogger başlangıçta bir kez başlatılır).',
  logPathsNote:     '"Yolları Göster"e basarak mevcut log dosyalarını listeleyin.',

  alertDeleteTitle:   'Log dosyalarını sil',
  alertDeleteMessage: 'Tüm log dosyaları silinecek. Devam edilsin mi?',
  alertCancel:        'İptal',
  alertDelete:        'Sil',

  tabContacts:             'Kişiler',
  sectionContacts:         'SIP Adres Defteri',
  inputName:               'Ad Soyad',
  inputSipUri:             'SIP URI',
  inputNotes:              'Notlar (isteğe bağlı)',
  btnSaveContact:          'Kişi Ekle',
  btnClearContacts:        'Tümünü Sil',
  contactsEmpty:           'Henüz kişi yok. Yukarıdan ekle.',
  contactsCount:           n => `${n} kişi`,
  contactsAlertClearTitle:   'Tüm kişileri sil',
  contactsAlertClearMessage: 'Adres defterindeki tüm kayıtlar silinecek. Devam edilsin mi?',
  contactAdded:            'Kişi eklendi',
};

const en: Translations = {
  tabHome:     'Home',
  tabMetrics:  'Metrics',
  tabSdkLogs:  'SDK Logs',
  tabSettings: 'Settings',

  statusNotCreated:  'NOT CREATED',
  statusCreated:     'CREATED',
  statusParamsSet:   'PARAMS SET',
  statusInitialized: 'INITIALIZED',

  sectionSdkLifecycle: 'SDK Lifecycle',
  sectionParameters:   'Parameters',
  sectionLogConsole:   'Log Console',
  sectionAppearance:   'App Appearance',
  sectionLogRotation:  'Log Rotation',
  sectionLogFiles:     'Log Files',

  stepCreate:    'Create',
  stepSetParams: 'SetParams',
  stepInit:      'Init',

  btnCreate:    '① Create',
  btnDestroy:   'Destroy',
  btnSetParams: '② Set Parameters',
  btnInitSdk:   '③ Initialize SDK',
  btnClear:     'Clear',
  btnFetch:     'Fetch',
  btnShowPaths: 'Show paths',
  btnDeleteAll: 'Delete all',

  cardLogging:      'Logging',
  cardHttp:         'HTTP',
  cardSip:          'SIP',
  cardTls:          'TLS',
  cardThreading:    'Threading',
  cardTheme:        'Theme',
  cardLanguage:     'Language',
  cardMaxFileSize:  'Max file size',
  cardMaxKeptFiles: 'Max kept files',

  switchEnabled:     'Enabled',
  switchPjEnabled:   'PJ Enabled',
  switchRxTxEnabled: 'RxTx Enabled',
  switchTcpEnabled:  'TCP Enabled',
  switchTlsEnabled:  'TLS Enabled',
  switchIpv6Enabled: 'IPv6 Enabled',
  switchMtlsEnabled: 'mTLS Enabled',

  inputLevel:           'Level (0-5)',
  inputPjLevel:         'PJ Level',
  inputPort:            'Port',
  inputUdpPort:         'UDP Port',
  inputTcpPort:         'TCP Port',
  inputTlsPort:         'TLS Port',
  inputCertPath:        'Cert Path',
  inputPrivKeyPath:     'Private Key Path',
  inputCaListPath:      'CA List Path',
  inputSipRxThreads:    'SIP Rx Threads',
  inputSipWorkerThreads: 'SIP Worker Threads',

  logPlaceholder:    'Logs will appear here…',
  logSdkPlaceholder: 'SDK log events appear here\nafter Create → Initialize.',
  sdkLogHint: n => `${n} entries (also saved to file)`,

  metricsHintInitial:  'Pull down or tap Fetch',
  metricsLastFetched:  t => `Last fetched: ${t}`,
  metricsEmpty:        'No metrics yet.\nInitialize the SDK on the Home tab, then tap Fetch.',
  metricsRawTitle:     'Raw Prometheus Output',
  metricsNoSdk:        'SDK not created. Go to Home and press Create first.',

  themeDark:  '🌙 Dark',
  themeLight: '☀️ Light',
  langTr:     '🇹🇷 Türkçe',
  langEn:     '🇬🇧 English',

  fileSizeLabel:   mb => `${mb} MB`,
  filesCountLabel: n  => n === 0 ? 'Unlimited' : `${n} files`,

  settingsFileNote: 'Changes take effect after next app restart (FileLogger initialises once at startup).',
  logPathsNote:     'Tap "Show paths" to list current log files.',

  alertDeleteTitle:   'Delete log files',
  alertDeleteMessage: 'All log files will be deleted. Continue?',
  alertCancel:        'Cancel',
  alertDelete:        'Delete',

  tabContacts:             'Contacts',
  sectionContacts:         'SIP Address Book',
  inputName:               'Display Name',
  inputSipUri:             'SIP URI',
  inputNotes:              'Notes (optional)',
  btnSaveContact:          'Add Contact',
  btnClearContacts:        'Clear All',
  contactsEmpty:           'No contacts yet. Add one above.',
  contactsCount:           n => `${n} contact${n === 1 ? '' : 's'}`,
  contactsAlertClearTitle:   'Delete all contacts',
  contactsAlertClearMessage: 'All contacts will be deleted. Continue?',
  contactAdded:            'Contact added',
};

export function getTranslation(language: AppLanguage): Translations {
  return language === 'en' ? en : tr;
}
