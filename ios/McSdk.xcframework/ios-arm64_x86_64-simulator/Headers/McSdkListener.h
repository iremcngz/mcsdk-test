#pragma once

#import <Foundation/Foundation.h>

#import "McSdkDocument.h"
#import "McSdkError.h"
#import "McSdkRegistrationPhase.h"
#import "McSdkRegistrationState.h"

// Mirrors SdkListener in core/Listeners/SdkListener.h.
// Callbacks may be delivered on a background thread — do not update UI directly.
@protocol McSdkListener <NSObject>

- (void)onReady;
- (void)onTerminated;
- (void)onSdkError:(McSdkError)error;
- (void)onRegistrationProgress:(McSdkRegistrationState)state phase:(McSdkRegistrationPhase)phase progress:(NSInteger)progress;
- (void)onRegistered;
- (void)onRegistrationFailed;
- (void)onDocumentsUpdated:(NSArray<McSdkDocument*>*)docs;

@end
