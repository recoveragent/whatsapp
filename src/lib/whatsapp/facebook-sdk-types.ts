declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (params: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FacebookLoginResponse) => void,
        options: FacebookLoginOptions,
      ) => void;
    };
  }
}

export interface FacebookLoginResponse {
  authResponse?: {
    code?: string;
    accessToken?: string;
    userID?: string;
  };
  status?: string;
}

export interface FacebookLoginOptions {
  config_id: string;
  response_type: string;
  override_default_response_type: boolean;
  extras: {
    setup: Record<string, unknown>;
    featureType?: string;
    sessionInfoVersion: string;
    feature?: string;
  };
}

export interface EmbeddedSignupSession {
  waba_id: string;
  phone_number_id?: string;
}

/** Meta session event when coexistence onboarding completes. */
export const COEXISTENCE_FINISH_EVENT = 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
export const COEXISTENCE_FEATURE_TYPE = 'whatsapp_business_app_onboarding';

export {};
