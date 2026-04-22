#pragma once

#import <Foundation/Foundation.h>

#import "McSdkError.h"

// Mirrors SdkListener in core/Listeners/SdkListener.h.
// Callbacks may be delivered on a background thread — do not update UI directly.
@protocol McSdkListener <NSObject>

- (void)onReady;
- (void)onFetchDocument:(NSString*)url content:(NSString*)content;
- (void)onSdsSent:(NSString*)target body:(NSString*)body;
- (void)onSdsReceived:(NSString*)sender body:(NSString*)body;
- (void)onSdsError:(NSString*)target error:(McSdkError)error;

@end
