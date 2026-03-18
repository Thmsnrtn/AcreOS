declare module '@capacitor/camera' {
  export const Camera: any;
  export enum CameraResultType { Uri = 'uri', Base64 = 'base64', DataUrl = 'dataUrl' }
  export enum CameraSource { Prompt = 'PROMPT', Camera = 'CAMERA', Photos = 'PHOTOS' }
}
declare module '@capacitor/geolocation' {
  export const Geolocation: any;
}
declare module '@capacitor/network' {
  export const Network: any;
}
declare module '@capacitor/preferences' {
  export const Preferences: any;
}
