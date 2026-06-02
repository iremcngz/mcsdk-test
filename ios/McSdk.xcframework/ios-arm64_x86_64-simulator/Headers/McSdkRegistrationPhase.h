#pragma once

#import <Foundation/Foundation.h>

// Mirrors RegistrationPhase in core/Modules/Registration/RegistrationPhase.h
typedef NS_ENUM(NSInteger, McSdkRegistrationPhase) {
    McSdkRegistrationPhaseUnregistered = 0,
    McSdkRegistrationPhaseCheckingDocuments = 1,
    McSdkRegistrationPhaseVerifyingDocsAndAuth = 2,
    McSdkRegistrationPhaseDownloadingBms = 3,
    McSdkRegistrationPhaseAuthenticating = 4,
    McSdkRegistrationPhaseDownloadingCms = 5,
    McSdkRegistrationPhaseDownloadingGms = 6,
    McSdkRegistrationPhaseSipRegistering = 7,
    McSdkRegistrationPhaseSipAffiliating = 8,
    McSdkRegistrationPhaseRegistered = 9,
    McSdkRegistrationPhaseDeaffiliating = 10,
    McSdkRegistrationPhaseDeregistering = 11,
    McSdkRegistrationPhaseIdmsLogout = 12,
    McSdkRegistrationPhaseFailed = 13,
};
