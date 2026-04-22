#pragma once

#import <Foundation/Foundation.h>

// Mirrors AlarmSeverity in core/Modules/Alarm/AlarmSeverity.h
typedef NS_ENUM(NSInteger, McSdkAlarmSeverity) {
    McSdkAlarmSeverityUnknown = 0,
    McSdkAlarmSeverityResolved = 1,
    McSdkAlarmSeverityManuallyResolved = 2,
    McSdkAlarmSeverityMinor = 3,
    McSdkAlarmSeverityMajor = 4,
    McSdkAlarmSeverityCritical = 5,
};
