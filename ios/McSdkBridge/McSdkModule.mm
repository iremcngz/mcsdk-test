#import "McSdkModule.h"
#import "McSdk.h"
#import "McSdkDocument.h"
#import "McSdkDocuments.h"
#import "McSdkParams.h"
#import "McSdkListener.h"
#import "McSdkLogListener.h"
#import "McSdkAlarmListener.h"
#import "McSdkAlarm.h"
#import "McSdkAlarmSeverity.h"
#import "McSdkError.h"
#import "McSdkIdentity.h"
#import "McSdkRegistrationPhase.h"
#import "McSdkRegistrationState.h"

static McSdk *gSdk = nil;
static BOOL gSdkInitialized = NO;
static BOOL gSdkInitializing = NO;  // prevents concurrent init calls

@interface McSdkModule () <McSdkListener, McSdkLogListener, McSdkAlarmListener>
@property (nonatomic, assign) BOOL hasListeners;
// Stored promise callbacks — resolved by onReady / onSdkError (initSdk is async)
@property (nonatomic, copy) RCTPromiseResolveBlock initResolve;
@property (nonatomic, copy) RCTPromiseRejectBlock  initReject;
@end

@implementation McSdkModule

RCT_EXPORT_MODULE(McSdk)

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"McSdkFetchDocument",
    @"McSdkSdsSent",
    @"McSdkSdsReceived",
    @"McSdkSdsError",
    @"McSdkAlarm",
    @"McSdkLog",
    @"McSdkRegistration",
    @"McSdkStoreDocuments"
  ];
}

- (void)startObserving {
  self.hasListeners = YES;
}

- (void)stopObserving {
  self.hasListeners = NO;
}

// Always dispatch async to avoid deadlock when SDK calls back
// synchronously during initSdk (which runs on the JS thread).
- (void)emitEvent:(NSString *)name body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.hasListeners) {
      [self sendEventWithName:name body:body];
    }
  });
}

#pragma mark - Exported Methods

RCT_EXPORT_METHOD(create) {
  if (gSdk == nil) {
    gSdk = [[McSdk alloc] init];
    [gSdk setListener:self];
    [gSdk setLogListener:self];
    [gSdk setAlarmListener:self];
  }
}

RCT_EXPORT_METHOD(destroy) {
  if (gSdk != nil) {
    [gSdk destroy];
    gSdk = nil;
    gSdkInitialized = NO;
    gSdkInitializing = NO;
  }
}

RCT_EXPORT_METHOD(setParams:(NSString *)paramsJson) {
  if (gSdk == nil) return;

  NSData *data = [paramsJson dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) { NSLog(@"[McSdk] setParams: invalid JSON string"); return; }

  NSError *err = nil;
  NSDictionary *d = [NSJSONSerialization JSONObjectWithData:data options:0 error:&err];
  if (!d) { NSLog(@"[McSdk] setParams: JSON parse error: %@", err); return; }

  NSLog(@"[McSdk] setParams JSON parsed: sipRxThreads=%@ sipWorkerThreads=%@",
        d[@"sipRxThreads"], d[@"sipWorkerThreads"]);

  McSdkLoggingParams *logging = [[McSdkLoggingParams alloc] init];
  logging.enabled = [d[@"logEnabled"] integerValue] != 0;
  logging.level = (McSdkLogLevel)[d[@"logLevel"] integerValue];
  logging.pjEnabled = [d[@"pjLogEnabled"] integerValue] != 0;
  logging.pjLevel = (McSdkLogLevel)[d[@"pjLogLevel"] integerValue];
  logging.rxTxEnabled = [d[@"rxTxEnabled"] integerValue] != 0;

  McSdkHttpParams *http = [[McSdkHttpParams alloc] init];
  http.port = [d[@"httpPort"] integerValue];

  McSdkSipParams *sip = [[McSdkSipParams alloc] init];
  sip.udpPort = [d[@"sipUdpPort"] integerValue];
  sip.tcpEnabled = [d[@"sipTcpEnabled"] integerValue] != 0;
  sip.tcpPort = [d[@"sipTcpPort"] integerValue];
  sip.tlsEnabled = [d[@"sipTlsEnabled"] integerValue] != 0;
  sip.tlsPort = [d[@"sipTlsPort"] integerValue];
  sip.ipv6Enabled = [d[@"sipIpv6Enabled"] integerValue] != 0;

  McSdkTlsParams *tls = [[McSdkTlsParams alloc] init];
  tls.mTlsEnabled = [d[@"mTlsEnabled"] integerValue] != 0;
  tls.certPath = d[@"certPath"] ?: @"";
  tls.privKeyPath = d[@"privKeyPath"] ?: @"";
  tls.caListPath = d[@"caListPath"] ?: @"";

  McSdkThreadingParams *threading = [[McSdkThreadingParams alloc] init];
  // Clamp to minimum 1: pjsip debug asserts that async_cnt > 0.
  threading.sipRxThreadCount    = MAX(1, [d[@"sipRxThreads"] integerValue]);
  threading.sdkWorkerThreadCount = MAX(1, [d[@"sipWorkerThreads"] integerValue]);

  NSLog(@"[McSdk] threading: sipRxThreadCount=%ld sdkWorkerThreadCount=%ld",
        (long)threading.sipRxThreadCount, (long)threading.sdkWorkerThreadCount);

  McSdkMcxParams *mcx = [[McSdkMcxParams alloc] init];
  mcx.idmsUrl = d[@"idmsUrl"] ?: @"";
  mcx.bmsUrl = d[@"bmsUrl"] ?: @"";
  mcx.cmsUrl = d[@"cmsUrl"] ?: @"";
  mcx.gmsUrl = d[@"gmsUrl"] ?: @"";
  mcx.mock = [d[@"mock"] integerValue] != 0;

  NSLog(@"[McSdk] mcx: idmsUrl=%@ bmsUrl=%@ cmsUrl=%@ gmsUrl=%@ mock=%d",
        mcx.idmsUrl, mcx.bmsUrl, mcx.cmsUrl, mcx.gmsUrl, mcx.mock);

  McSdkParams *params = [[McSdkParams alloc] init];
  params.Logging = logging;
  params.Http = http;
  params.Sip = sip;
  params.Tls = tls;
  params.Threading = threading;
  params.Mcx = mcx;

  [gSdk setParams:params];
}

RCT_EXPORT_METHOD(init:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
  if (gSdk == nil) {
    resolve(@(NO));
    return;
  }
  if (gSdkInitialized) {
    resolve(@(YES));
    return;
  }
  if (gSdkInitializing) {
    reject(@"INIT_IN_PROGRESS", @"SDK initialisation is already in progress", nil);
    return;
  }
  gSdkInitializing = YES;
  self.initResolve = resolve;
  self.initReject  = reject;
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    [gSdk initSdk];  // void — result delivered via onReady / onSdkError
  });
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(listMetrics) {
  if (gSdk == nil) return @"";
  NSString *result = [gSdk listMetrics];
  return result ? result : @"";
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(listAlarms) {
  if (gSdk == nil) return @"";
  NSString *result = [gSdk listAlarms];
  return result ? result : @"";
}

RCT_EXPORT_METHOD(raiseAlarm:(NSString *)name info:(NSString *)info severity:(double)severity) {
  if (gSdk == nil) return;
  McSdkAlarm *alarm = [[McSdkAlarm alloc] initWithName:name info:info severity:(McSdkAlarmSeverity)(NSInteger)severity];
  [gSdk raiseAlarm:alarm];
}

RCT_EXPORT_METHOD(resolveAlarm:(NSString *)name) {
  if (gSdk == nil) return;
  [gSdk resolveAlarmByName:name];
}

RCT_EXPORT_METHOD(sendSds:(NSString *)target body:(NSString *)body) {
  if (gSdk == nil) return;
  [gSdk sendSds:target body:body];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getData:(NSString *)key) {
  if (gSdk == nil) return @"";
  NSString *result = [gSdk getData:key];
  return result ? result : @"";
}

RCT_EXPORT_METHOD(createData:(NSString *)key value:(NSString *)value) {
  if (gSdk == nil) return;
  [gSdk createData:key value:value];
}

RCT_EXPORT_METHOD(updateData:(NSString *)key value:(NSString *)value) {
  if (gSdk == nil) return;
  [gSdk updateData:key value:value];
}

RCT_EXPORT_METHOD(deleteData:(NSString *)key) {
  if (gSdk == nil) return;
  [gSdk deleteData:key];
}

RCT_EXPORT_METHOD(importData:(NSString *)data) {
  if (gSdk == nil) return;
  [gSdk importData:data];
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(exportData) {
  if (gSdk == nil) return @"";
  NSString *result = [gSdk exportData];
  return result ? result : @"";
}

RCT_EXPORT_METHOD(fetchDocument:(NSString *)url) {
  if (gSdk == nil) return;
  [gSdk fetchDocument:url];
}

RCT_EXPORT_METHOD(setIdentity:(NSString *)mcId
                  password:(NSString *)password
                  clientId:(NSString *)clientId) {
  if (gSdk == nil) return;
  McSdkIdentity *identity = [[McSdkIdentity alloc] init];
  identity.mcId     = mcId;
  identity.password = password;
  identity.clientId = clientId;
  [gSdk setIdentity:identity];
}

RCT_EXPORT_METHOD(register) {
  if (gSdk == nil) return;
  [gSdk register];
}

RCT_EXPORT_METHOD(unregister) {
  if (gSdk == nil) return;
  [gSdk unregister];
}

RCT_EXPORT_METHOD(setDocuments:(NSString *)docsJson) {
  if (gSdk == nil) return;
  NSData *data = [docsJson dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return;
  NSArray *arr = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (!arr) return;
  McSdkDocuments *documents = [[McSdkDocuments alloc] init];
  NSMutableArray<McSdkDocument*> *docList = [NSMutableArray arrayWithCapacity:arr.count];
  for (NSDictionary *obj in arr) {
    McSdkDocument *d = [[McSdkDocument alloc] init];
    d.uri      = obj[@"uri"] ?: @"";
    d.etag     = obj[@"etag"] ?: @"";
    d.content  = obj[@"content"] ?: @"";
    d.type     = (McSdkDocumentType)[obj[@"type"] integerValue];
    d.fetchedAt = [obj[@"fetchedAt"] longValue];
    [docList addObject:d];
  }
  documents.documents = [docList copy];
  [gSdk setDocuments:documents];
}

// Required by New Architecture TurboModule spec — RCTEventEmitter handles the
// actual subscription management internally; these stubs ensure startObserving
// and stopObserving are triggered so hasListeners is set correctly.
RCT_EXPORT_METHOD(addListener:(NSString *)eventName) {
  [super addListener:eventName];
}
RCT_EXPORT_METHOD(removeListeners:(double)count) {
  [super removeListeners:(NSInteger)count];
}

#pragma mark - McSdkListener

- (void)onReady {
  gSdkInitialized = YES;
  gSdkInitializing = NO;
  if (self.initResolve) {
    self.initResolve(@(YES));
    self.initResolve = nil;
    self.initReject  = nil;
  }
  [self emitEvent:@"McSdkLog" body:@{@"level": @(2), @"log": @"SDK ready"}];
}

- (void)onTerminated {
  [self emitEvent:@"McSdkLog" body:@{@"level": @(2), @"log": @"SDK terminated"}];
}

- (void)onSdkError:(McSdkError)error {
  gSdkInitializing = NO;
  if (self.initReject) {
    self.initReject(@"SDK_ERROR", [NSString stringWithFormat:@"SDK error: %ld", (long)error], nil);
    self.initResolve = nil;
    self.initReject  = nil;
  }
}

- (void)onRegistrationProgress:(McSdkRegistrationState)state
                         phase:(McSdkRegistrationPhase)phase
                      progress:(NSInteger)progress {
  [self emitEvent:@"McSdkRegistration" body:@{
    @"state":    @(state),
    @"phase":    @(phase),
    @"progress": @(progress)
  }];
}

- (void)onRegistered {
  [self emitEvent:@"McSdkRegistration" body:@{
    @"state":    @(McSdkRegistrationStateRegistered),
    @"phase":    @(McSdkRegistrationPhaseRegistered),
    @"progress": @(100)
  }];
}

- (void)onRegistrationFailed {
  [self emitEvent:@"McSdkRegistration" body:@{
    @"state":    @(McSdkRegistrationStateUnregistered),
    @"phase":    @(McSdkRegistrationPhaseFailed),
    @"progress": @(0)
  }];
}

- (void)onDocumentsUpdated:(NSArray<McSdkDocument *> *)docs {
  NSMutableArray *arr = [NSMutableArray arrayWithCapacity:docs.count];
  for (McSdkDocument *doc in docs) {
    [arr addObject:@{
      @"uri":       doc.uri ?: @"",
      @"etag":      doc.etag ?: @"",
      @"content":   doc.content ?: @"",
      @"type":      @(doc.type),
      @"fetchedAt": @(doc.fetchedAt),
    }];
  }
  NSError *err = nil;
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:arr options:0 error:&err];
  if (!jsonData) return;
  NSString *docsJson = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
  [self emitEvent:@"McSdkStoreDocuments" body:@{@"docsJson": docsJson}];
}

- (void)onFetchDocument:(NSString *)url content:(NSString *)content {
  [self emitEvent:@"McSdkFetchDocument" body:@{@"url": url, @"content": content}];
}

- (void)onSdsSent:(NSString *)target body:(NSString *)body {
  [self emitEvent:@"McSdkSdsSent" body:@{@"target": target, @"body": body}];
}

- (void)onSdsReceived:(NSString *)sender body:(NSString *)body {
  [self emitEvent:@"McSdkSdsReceived" body:@{@"sender": sender, @"body": body}];
}

- (void)onSdsError:(NSString *)target error:(McSdkError)error {
  [self emitEvent:@"McSdkSdsError" body:@{@"target": target, @"error": @(error)}];
}

#pragma mark - McSdkLogListener

- (void)onLog:(NSInteger)level log:(NSString *)log {
  [self emitEvent:@"McSdkLog" body:@{@"level": @(level), @"log": log}];
}

#pragma mark - McSdkAlarmListener

- (void)onAlarm:(NSString *)alarm {
  [self emitEvent:@"McSdkAlarm" body:@{@"alarm": alarm}];
}

@end
