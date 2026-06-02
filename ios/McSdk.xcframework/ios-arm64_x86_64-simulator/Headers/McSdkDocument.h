#pragma once

#import <Foundation/Foundation.h>

// Mirrors DocumentType in core/Modules/Session/Document/Document.h
typedef NS_ENUM(NSInteger, McSdkDocumentType) {
    McSdkDocumentTypeUnknown = 0,
    McSdkDocumentTypeUeInit = 1,
    McSdkDocumentTypeUeConfig = 2,
    McSdkDocumentTypeUserAdditions = 3,
    McSdkDocumentTypeServiceConfig = 4,
    McSdkDocumentTypeUserProfile = 5,
    McSdkDocumentTypeGroupProfile = 6,
};

// Mirrors Document in core/Modules/Session/Document/Document.h
@interface McSdkDocument : NSObject

@property(nonatomic, copy) NSString* uri;
@property(nonatomic, copy) NSString* etag;
@property(nonatomic, copy) NSString* content;
@property(nonatomic, assign) McSdkDocumentType type;
@property(nonatomic, assign) long fetchedAt;

@end
