#pragma once

#import <Foundation/Foundation.h>

// Mirrors LogLevel in core/Modules/Params/ParamTypes.h
typedef NS_ENUM(NSInteger, McSdkLogLevel) {
    McSdkLogLevelVerbose = 0,
    McSdkLogLevelDebug = 1,
    McSdkLogLevelInfo = 2,
    McSdkLogLevelWarn = 3,
    McSdkLogLevelError = 4,
    McSdkLogLevelFatal = 5,
};

// Mirrors SdkParams in core/Modules/Params/ParamTypes.h
@interface McSdkLoggingParams : NSObject
@property(nonatomic, assign) BOOL enabled;
@property(nonatomic, assign) McSdkLogLevel level;
@property(nonatomic, assign) BOOL pjEnabled;
@property(nonatomic, assign) McSdkLogLevel pjLevel;
@property(nonatomic, assign) BOOL rxTxEnabled;
@end

@interface McSdkHttpParams : NSObject
@property(nonatomic, assign) NSInteger port;
@end

@interface McSdkSipParams : NSObject
@property(nonatomic, assign) NSInteger udpPort;
@property(nonatomic, assign) BOOL tcpEnabled;
@property(nonatomic, assign) NSInteger tcpPort;
@property(nonatomic, assign) BOOL tlsEnabled;
@property(nonatomic, assign) NSInteger tlsPort;
@property(nonatomic, assign) BOOL ipv6Enabled;
@end

@interface McSdkTlsParams : NSObject
@property(nonatomic, assign) BOOL mTlsEnabled;
@property(nonatomic, copy) NSString* certPath;
@property(nonatomic, copy) NSString* privKeyPath;
@property(nonatomic, copy) NSString* caListPath;
@end

@interface McSdkThreadingParams : NSObject
@property(nonatomic, assign) NSInteger sipRxThreadCount;
@property(nonatomic, assign) NSInteger sipWorkerThreadCount;
@end

@interface McSdkParams : NSObject
@property(nonatomic, strong) McSdkLoggingParams* Logging;
@property(nonatomic, strong) McSdkHttpParams* Http;
@property(nonatomic, strong) McSdkSipParams* Sip;
@property(nonatomic, strong) McSdkTlsParams* Tls;
@property(nonatomic, strong) McSdkThreadingParams* Threading;
@end
