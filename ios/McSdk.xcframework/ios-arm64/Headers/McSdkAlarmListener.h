#pragma once

#import <Foundation/Foundation.h>

// Mirrors AlarmListener in core/Listeners/AlarmListener.h.
// Callbacks may be delivered on a background thread.
@protocol McSdkAlarmListener <NSObject>

- (void)onAlarm:(NSString*)alarm;

@end
