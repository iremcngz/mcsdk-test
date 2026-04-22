#pragma once

#import <Foundation/Foundation.h>

#import "McSdkAlarm.h"
#import "McSdkAlarmListener.h"
#import "McSdkError.h"
#import "McSdkListener.h"
#import "McSdkLogListener.h"
#import "McSdkParams.h"

// Objective-C entry-point for the mc-sdk native library.
//
// Only one instance should exist per process (mirrors the singleton
// constraint of the underlying C++ Sdk class). Call -destroy when the
// SDK is no longer needed to release all native resources.
//
// Typical usage:
//   McSdk *sdk = [[McSdk alloc] init];
//   [sdk setParams:params];
//   [sdk setListener:self];
//   [sdk init];           // returns YES on success
//   [sdk sendSds:@"sip:test@127.0.0.1" body:@"hello"];
//   // ... use ...
//   [sdk destroy];
//
@interface McSdk : NSObject

// Configures the SDK. Must be called before -init.
- (void)setParams:(McSdkParams*)params;

// Registers the primary event listener. Must be set before -initSdk.
- (void)setListener:(id<McSdkListener>)listener;

// Registers a log listener. Optional.
- (void)setLogListener:(id<McSdkLogListener>)logListener;

// Registers an alarm listener. Optional.
- (void)setAlarmListener:(id<McSdkAlarmListener>)alarmListener;

// Initialises the SDK. Call once after -setParams and -setListener.
// Returns YES on success. Named initSdk to avoid collision with NSObject -init.
- (BOOL)initSdk;

// Releases all native resources. Must be called when finished with the SDK.
- (void)destroy;

// ── Alarm ────────────────────────────────────────────────────────────────────
- (void)raiseAlarm:(McSdkAlarm*)alarm;
- (void)resolveAlarmByName:(NSString*)alarmName;
- (NSString*)listAlarms;

// ── Metrics ──────────────────────────────────────────────────────────────────
- (NSString*)listMetrics;

// ── DAO ──────────────────────────────────────────────────────────────────────
- (void)createData:(NSString*)key value:(NSString*)value;
- (void)updateData:(NSString*)key value:(NSString*)value;
- (void)deleteData:(NSString*)key;
- (NSString*)getData:(NSString*)key;
- (void)importData:(NSString*)data;
- (NSString*)exportData;

// ── Messaging ────────────────────────────────────────────────────────────────
- (void)fetchDocument:(NSString*)url;
- (void)sendSds:(NSString*)target body:(NSString*)body;

@end
