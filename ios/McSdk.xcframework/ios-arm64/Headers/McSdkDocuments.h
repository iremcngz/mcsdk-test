#pragma once

#import <Foundation/Foundation.h>

#import "McSdkDocument.h"

// Mirrors std::vector<Document> passed via Sdk::SetDocuments
@interface McSdkDocuments : NSObject

@property(nonatomic, copy) NSArray<McSdkDocument*>* documents;

@end
