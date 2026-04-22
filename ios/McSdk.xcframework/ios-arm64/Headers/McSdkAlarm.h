#pragma once

#import <Foundation/Foundation.h>

#import "McSdkAlarmSeverity.h"

// Mirrors Alarm in core/Modules/Alarm/Alarm.h
@interface McSdkAlarm : NSObject

@property(nonatomic, copy, readonly) NSString* name;
@property(nonatomic, copy, readonly) NSString* info;
@property(nonatomic, assign, readonly) McSdkAlarmSeverity severity;

- (instancetype)initWithName:(NSString*)name info:(NSString*)info;
- (instancetype)initWithName:(NSString*)name info:(NSString*)info severity:(McSdkAlarmSeverity)severity;

@end
