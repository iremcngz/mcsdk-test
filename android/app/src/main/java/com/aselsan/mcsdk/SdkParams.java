package com.aselsan.mcsdk;

/**
 * Configuration parameters for the SDK. Mirrors {@code SdkParams} in
 * {@code core/Modules/Params/ParamTypes.h}.
 *
 * <p>Default values match the C++ defaults. Construct, customise, then call
 * {@link McSdk#setParams} before {@link McSdk#init()}.
 */
public class SdkParams {

    public final LoggingParams   Logging   = new LoggingParams();
    public final HttpParams      Http      = new HttpParams();
    public final SipParams       Sip       = new SipParams();
    public final TlsParams       Tls       = new TlsParams();
    public final ThreadingParams Threading = new ThreadingParams();

    public static class LoggingParams {
        public boolean  enabled      = true;
        public LogLevel level        = LogLevel.DEBUG;
        public boolean  pjEnabled    = false;
        public LogLevel pjLevel      = LogLevel.DEBUG;
        public boolean  rxTxEnabled  = false;
    }

    public static class HttpParams {
        public int port = 8008;
    }

    public static class SipParams {
        public int     udpPort     = 5060;
        public boolean tcpEnabled  = false;
        public int     tcpPort     = 5060;
        public boolean tlsEnabled  = false;
        public int     tlsPort     = 5061;
        public boolean ipv6Enabled = false;
    }

    public static class TlsParams {
        public boolean mTlsEnabled  = false;
        public String  certPath     = "cert/client.crt";
        public String  privKeyPath  = "cert/client.key";
        public String  caListPath   = "cert/ca.pem";
    }

    public static class ThreadingParams {
        public int sipRxThreadCount     = 1;
        public int sipWorkerThreadCount = 1;
    }
}
