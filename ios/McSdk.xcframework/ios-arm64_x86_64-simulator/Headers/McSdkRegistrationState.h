#pragma once

#import <Foundation/Foundation.h>

// Mirrors RegistrationState in core/Modules/Registration/RegistrationState.h
typedef NS_ENUM(NSInteger, McSdkRegistrationState) {
    McSdkRegistrationStateUnregistered = 0,
    McSdkRegistrationStateRegistering = 1,
    McSdkRegistrationStateRegistered = 2,
    McSdkRegistrationStateUnregistering = 3,
};
