#pragma once

#import <Foundation/Foundation.h>

// Mirrors RegistrationPhase in core/Modules/Registration/RegistrationPhase.h
typedef NS_ENUM(NSInteger, McSdkRegistrationPhase) {
    McSdkRegistrationPhaseIdle = 0,
    McSdkRegistrationPhaseDownloadingBms = 1,
    McSdkRegistrationPhaseAuthenticating = 2,
    McSdkRegistrationPhaseDownloadingConfiguration = 3,
    McSdkRegistrationPhaseSipRegistering = 4,
    McSdkRegistrationPhaseSipAffiliating = 5,
    McSdkRegistrationPhaseDone = 6,
};
