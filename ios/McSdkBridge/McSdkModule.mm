#import "McSdkModule.h"
#import "McSdk.h"
#import "McSdkParams.h"
#import "McSdkListener.h"
#import "McSdkLogListener.h"
#import "McSdkAlarmListener.h"
#import "McSdkAlarm.h"
#import "McSdkAlarmSeverity.h"
#import "McSdkError.h"

static McSdk *gSdk = nil;
static BOOL gSdkInitialized = NO;
static BOOL gSdkInitializing = NO;  // prevents concurrent init calls

@interface McSdkModule () <McSdkListener, McSdkLogListener, McSdkAlarmListener>
@property (nonatomic, assign) BOOL hasListeners;
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
    @"McSdkLog"
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
  threading.sipRxThreadCount = MAX(1, [d[@"sipRxThreads"] integerValue]);
  threading.sipWorkerThreadCount = MAX(1, [d[@"sipWorkerThreads"] integerValue]);

  NSLog(@"[McSdk] threading: sipRxThreadCount=%ld sipWorkerThreadCount=%ld",
        (long)threading.sipRxThreadCount, (long)threading.sipWorkerThreadCount);

  McSdkParams *params = [[McSdkParams alloc] init];
  params.Logging = logging;
  params.Http = http;
  params.Sip = sip;
  params.Tls = tls;
  params.Threading = threading;

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
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    BOOL result = [gSdk initSdk];
    if (result) {
      gSdkInitialized = YES;
    }
    gSdkInitializing = NO;
    resolve(@(result));
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
  // No sendSds method in ObjC API — placeholder for compatibility
}

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getDaoData) {
  return @"";
}

#pragma mark - McSdkListener

- (void)onReady {
  [self emitEvent:@"McSdkLog" body:@{@"level": @(3), @"log": @"SDK ready"}];
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
