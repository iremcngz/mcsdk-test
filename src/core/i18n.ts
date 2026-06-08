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
  cardMcx: string;
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
  switchMockEnabled: string;

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
  inputIdmsUrl: string;
  inputBmsUrl: string;
  inputCmsUrl: string;
  inputGmsUrl: string;

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

  // ── Talk screen
  tabTalk: string;
  talkGroupsTitle: string;
  talkSelectedGroup: string;
  talkMenuStartAlert: string;
  talkMenuStartImminentPeril: string;
  talkMenuStartEmergency: string;
  talkMenuGroupDetails: string;
  talkMenuMuteOff: string;
  talkButton: string;
  talkButtonHold: string;
  talkHoldHint: string;
  talkNoCallHint: string;
  talkSpeakerYou: string;
  talkOccupiedBy: (speaker: string) => string;
  talkStatusIdle: string;
  talkStatusAccepted: string;
  talkStatusOccupied: string;
  talkStatusActive: string;
  talkStatusTalking: string;
  talkModeReceive: string;
  talkModeTransmit: string;
  talkModeMessages: string;
  talkBtnStartCall: string;
  talkBtnEndCall: string;
  talkMockPanelTitle: string;
  talkMockAccept: string;
  talkMockOccupy: string;
  talkMockReset: string;
  talkMicEnable: string;
  talkMicEnabled: string;
  talkMicDenied: string;
  talkMicDisabledHint: string;
  btnClearContacts: string;
  contactsEmpty: string;
  contactsCount: (n: number) => string;
  contactsAlertClearTitle: string;
  contactsAlertClearMessage: string;
  contactAdded: string;

  // ── Network / IP monitor
  ipLabel: (ip: string | null) => string;
  ipChanged: (prev: string | null, curr: string | null) => string;

  // ── Auth / Login
  loginTitle: string;
  inputUsername: string;
  inputPassword: string;
  btnLogin: string;
  loginError: string;

  // ── Account (Settings)
  sectionAccount: string;
  cardStayLoggedIn: string;
  btnLogout: string;

  // ── Calls tab
  tabCalls: string;
  callHistoryTitle: string;
  callHistoryEmpty: string;
  callHistoryCount: (n: number) => string;
  btnEndCall: string;
  btnRequestFloor: string;
  btnReleaseFloor: string;
  floorIdle: string;
  floorGranted: string;
  floorBusy: string;
  commencementAuto: string;
  commencementManual: string;
  btnJoinCall: string;
  callConnecting: string;
  callActive: string;
  callEnding: string;
  callTypeHD: string;
  callTypeFD: string;
  callDirectionOut: string;
  callDirectionIn: string;
  callDuration: (s: number) => string;
  btnClearHistory: string;
  btnCallBack: string;
  cardCommencement: string;

  // ── Messages / Chat
  talkMessagesTitle: string;
  talkMessagesEmpty: string;
  talkMessagesInputPlaceholder: string;
  talkMessagesSend: string;
  talkMessagesFile: string;
  talkMessagesImage: string;
  talkMessagesCamera: string;

  // ── Mock / test
  callIncoming: string;
  btnAcceptCall: string;
  btnRejectCall: string;
  mockPanelTitle: string;
  mockIncomingHD: string;
  mockIncomingFD: string;
  mockOutgoingHD: string;
  mockOutgoingFD: string;
  mockFloorBusy: string;
  mockFloorIdle: string;
  mockFloorGranted: string;
  mockRemoteHangup: string;
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
  cardMcx:          'MCX Sunucu URL',
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
  switchMockEnabled:  'Mock Modu',

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
  inputIdmsUrl:        'IDMS URL',
  inputBmsUrl:         'BMS URL',
  inputCmsUrl:         'CMS URL',
  inputGmsUrl:         'GMS URL',

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

  tabTalk:               'Talk',
  talkGroupsTitle:       'Gruplar',
  talkSelectedGroup:     'Seçilen grup',
  talkMenuStartAlert:        'Uyarıyı Başlat',
  talkMenuStartImminentPeril: 'Yakın Tehlikeyi Başlat',
  talkMenuStartEmergency:    'Acil Durumu Başlat',
  talkMenuGroupDetails:      'Grup Detayları',
  talkMenuMuteOff:           'Sesi Aç',
  talkButton:            'Push to talk',
  talkButtonHold:        'Hold to talk',
  talkSpeakerYou:        'You',
  talkHoldHint:          'Basılı tutarak konuşun',
  talkNoCallHint:        'Çağrı başlatın, sonra push kullanın',
  talkOccupiedBy:        speaker => `${speaker} konuşuyor`,
  talkStatusIdle:        'Boşta',
  talkStatusAccepted:    'Push kabul edildi',
  talkStatusOccupied:    'Başka konuşuyor',
  talkStatusActive:      'Çağrı aktif',
  talkStatusTalking:     'Konuşuyorsunuz',
  talkModeReceive:       'Receive',
  talkModeTransmit:      'Transmit',
  talkModeMessages:      'Messages',
  talkBtnStartCall:      'Start Call',
  talkBtnEndCall:        'End Call',
  talkMockPanelTitle:    'Mock Kontrol',
  talkMockAccept:        'Push accepted',
  talkMockOccupy:        'Other talking',
  talkMockReset:         'Reset',
  talkMicEnable:         'Mikrofonu etkinleştir',
  talkMicEnabled:        'Mikrofon etkin',
  talkMicDenied:         'Mikrofon izni reddedildi',
  talkMicDisabledHint:   'Ses göndermek için mikrofonu etkinleştirin',
  talkMessagesTitle:            'Mesajlar',
  talkMessagesEmpty:            'Henüz mesaj yok.',
  talkMessagesInputPlaceholder: 'Mesaj yazın…',
  talkMessagesSend:             'Gönder',
  talkMessagesFile:             'Dosya Ekle',
  talkMessagesImage:            'Resim Ekle',
  talkMessagesCamera:           'Kamera',
  contactsEmpty:         'Henüz kişi yok. Yukarıdan ekle.',
  contactsCount:           n => `${n} kişi`,
  contactsAlertClearTitle:   'Tüm kişileri sil',
  contactsAlertClearMessage: 'Adres defterindeki tüm kayıtlar silinecek. Devam edilsin mi?',
  contactAdded:            'Kişi eklendi',

  ipLabel:   ip => ip ? `IP: ${ip}` : 'Ağ yok',
  ipChanged: (p, c) => `[NET] IP değişti: ${p ?? '?'} → ${c ?? '?'}`,

  loginTitle:       'Giriş Yap',
  inputUsername:    'Kullanıcı Adı',
  inputPassword:    'Şifre',
  btnLogin:         'Giriş',
  loginError:       'Kullanıcı adı veya şifre hatalı',

  sectionAccount:   'Hesap',
  cardStayLoggedIn: 'Oturumu Açık Tut',
  btnLogout:        'Çıkış Yap',

  tabCalls:           'Aramalar',
  callHistoryTitle:   'Arama Geçmişi',
  callHistoryEmpty:   'Henüz tamamlanan arama yok.',
  callHistoryCount:   n => `${n} arama`,
  btnEndCall:         'Aramayı Bitir',
  btnRequestFloor:    'Kat Al',
  btnReleaseFloor:    'Katı Bırak',
  floorIdle:          'Kat Al',
  floorGranted:       'Konuşuluyor',
  floorBusy:          'Hat Meşgul',
  commencementAuto:   'OTOMATİK',
  commencementManual: 'MANUEL',
  btnJoinCall:        'Aramaya Katıl',
  callConnecting:     'Bağlanıyor…',
  callActive:         'Aktif',
  callEnding:         'Kapatılıyor…',
  callTypeHD:         'Yarı Dubleks',
  callTypeFD:         'Tam Dubleks',
  callDirectionOut:   'Giden',
  callDirectionIn:    'Gelen',
  callDuration:       s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  },
  btnClearHistory:    'Geçmişi Temizle',
  btnCallBack:        'Geri Ara',
  cardCommencement:   'Başlangıç Modu',

  // mock
  callIncoming:       'Gelen Arama',
  btnAcceptCall:      'Kabul Et',
  btnRejectCall:      'Reddet',
  mockPanelTitle:     '🧪 Mock Kontrol',
  mockIncomingHD:     'Gelen HD Arama',
  mockIncomingFD:     'Gelen FD Arama',
  mockOutgoingHD:     'Giden HD Arama',
  mockOutgoingFD:     'Giden FD Arama',
  mockFloorBusy:      'Floor Meşgul Yap',
  mockFloorIdle:      'Floor Serbest Bırak',
  mockFloorGranted:   'Floor Ver (Kendinize)',
  mockRemoteHangup:   'Karşı Taraf Kapattı',
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
  cardMcx:          'MCX Server URLs',
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
  switchMockEnabled:  'Mock Mode',

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
  inputIdmsUrl:         'IDMS URL',
  inputBmsUrl:          'BMS URL',
  inputCmsUrl:          'CMS URL',
  inputGmsUrl:          'GMS URL',

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

  tabTalk:               'Talk',
  talkGroupsTitle:       'Groups',
  talkSelectedGroup:     'Selected group',
  talkMenuStartAlert:        'Start Alert',
  talkMenuStartImminentPeril: 'Start Imminent Peril',
  talkMenuStartEmergency:    'Start Emergency',
  talkMenuGroupDetails:      'Group Details',
  talkMenuMuteOff:           'Mute Off',
  talkButton:            'Push to talk',
  talkButtonHold:        'Hold to talk',
  talkSpeakerYou:        'You',
  talkHoldHint:          'Press and hold while speaking',
  talkNoCallHint:        'Start call to enable push-to-talk',
  talkOccupiedBy:        speaker => `${speaker} is speaking`,
  talkStatusIdle:        'Idle',
  talkStatusAccepted:    'Push granted',
  talkStatusOccupied:    'Other speaking',
  talkStatusActive:      'Call active',
  talkStatusTalking:     'Talking',
  talkModeReceive:       'Receive',
  talkModeTransmit:      'Transmit',
  talkModeMessages:      'Messages',
  talkBtnStartCall:      'Start Call',
  talkBtnEndCall:        'End Call',
  talkMockPanelTitle:    'Mock Controls',
  talkMockAccept:        'Grant push',
  talkMockOccupy:        'Other talking',
  talkMockReset:         'Reset',
  talkMicEnable:         'Enable microphone',
  talkMicEnabled:        'Microphone enabled',
  talkMicDenied:         'Microphone permission denied',
  talkMicDisabledHint:   'Enable microphone to send audio',
  talkMessagesTitle:            'Messages',
  talkMessagesEmpty:            'No messages yet.',
  talkMessagesInputPlaceholder: 'Type a message…',
  talkMessagesSend:             'Send',
  talkMessagesFile:             'Attach File',
  talkMessagesImage:            'Attach Image',
  talkMessagesCamera:           'Camera',
  contactsEmpty:           'No contacts yet. Add one above.',
  contactsCount:           n => `${n} contact${n === 1 ? '' : 's'}`,
  contactsAlertClearTitle:   'Delete all contacts',
  contactsAlertClearMessage: 'All contacts will be deleted. Continue?',
  contactAdded:            'Contact added',

  ipLabel:   ip => ip ? `IP: ${ip}` : 'No network',
  ipChanged: (p, c) => `[NET] IP changed: ${p ?? '?'} → ${c ?? '?'}`,

  loginTitle:       'Sign In',
  inputUsername:    'Username',
  inputPassword:    'Password',
  btnLogin:         'Login',
  loginError:       'Invalid username or password',

  sectionAccount:   'Account',
  cardStayLoggedIn: 'Stay Logged In',
  btnLogout:        'Log Out',

  tabCalls:           'Calls',
  callHistoryTitle:   'Call History',
  callHistoryEmpty:   'No completed calls yet.',
  callHistoryCount:   n => `${n} call${n === 1 ? '' : 's'}`,
  btnEndCall:         'End Call',
  btnRequestFloor:    'Request Floor',
  btnReleaseFloor:    'Release Floor',
  floorIdle:          'Request Floor',
  floorGranted:       'Speaking',
  floorBusy:          'Floor Busy',
  commencementAuto:   'AUTO',
  commencementManual: 'MANUAL',
  btnJoinCall:        'Join Call',
  callConnecting:     'Connecting…',
  callActive:         'Active',
  callEnding:         'Ending…',
  callTypeHD:         'Half Duplex',
  callTypeFD:         'Full Duplex',
  callDirectionOut:   'Outgoing',
  callDirectionIn:    'Incoming',
  callDuration:       s => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  },
  btnClearHistory:    'Clear History',
  btnCallBack:        'Call Back',
  cardCommencement:   'Commencement Mode',

  // mock
  callIncoming:       'Incoming Call',
  btnAcceptCall:      'Accept',
  btnRejectCall:      'Reject',
  mockPanelTitle:     '🧪 Mock Controls',
  mockIncomingHD:     'Incoming HD Call',
  mockIncomingFD:     'Incoming FD Call',
  mockOutgoingHD:     'Outgoing HD Call',
  mockOutgoingFD:     'Outgoing FD Call',
  mockFloorBusy:      'Make Floor Busy',
  mockFloorIdle:      'Release Floor',
  mockFloorGranted:   'Grant Floor (Self)',
  mockRemoteHangup:   'Remote Hangup',
};

export function getTranslation(language: AppLanguage): Translations {
  return language === 'en' ? en : tr;
}
