#pragma once

#import <Foundation/Foundation.h>

// Mirrors SdkError in core/SdkError.h
typedef NS_ENUM(NSInteger, McSdkError) {
    McSdkErrorNotInitialized = 0,
    McSdkErrorBuildRequestFailed = 1,
    McSdkErrorAttachBodyFailed = 2,
    McSdkErrorSendFailed = 3,
};
