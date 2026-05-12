#pragma once

#import <Foundation/Foundation.h>

// Mirrors Identity in core/Modules/Session/Identity.h
@interface McSdkIdentity : NSObject

@property(nonatomic, copy) NSString* mcId;
@property(nonatomic, copy) NSString* password;
@property(nonatomic, copy) NSString* clientId;

@end
