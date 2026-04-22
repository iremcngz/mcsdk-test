#pragma once

#import <Foundation/Foundation.h>

// Mirrors LogListener in core/Listeners/LogListener.h.
// Callbacks may be delivered on a background thread.
// level corresponds to: 0=Verbose 1=Debug 2=Info 3=Warn 4=Error 5=Fatal
@protocol McSdkLogListener <NSObject>

- (void)onLog:(NSInteger)level log:(NSString*)log;

@end
