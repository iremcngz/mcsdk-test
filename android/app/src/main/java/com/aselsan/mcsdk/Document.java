package com.aselsan.mcsdk;

/**
 * Mirrors the C++ Document struct in core/Modules/Session/Documents.h.
 *
 * Instances are passed to {@link McSdk#setDocuments} and received from
 * {@link SdkListener#onStoreDocuments}.
 */
public class Document {
    public String uri       = "";
    public String timestamp = "";
    public String etag      = "";
    public String org       = "";
    public String content   = "";
    public String size      = "";
}
