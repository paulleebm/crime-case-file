// Firebase 웹 앱 설정. 브라우저에 공개되는 식별자이며 비밀 값이 아니다.
// 남용 방지는 App Check와 Firebase 콘솔의 API 키 제한으로 한다.
export const firebaseConfig = {
  apiKey: 'AIzaSyDD5YIarSCm-MzFYg7dwDtwgbqQO_AcSOY',
  authDomain: 'crime-case-file.firebaseapp.com',
  projectId: 'crime-case-file',
  storageBucket: 'crime-case-file.firebasestorage.app',
  messagingSenderId: '1033313347936',
  appId: '1:1033313347936:web:f2102a515642659a4e1605',
};

/** App Check(reCAPTCHA Enterprise) 사이트 키. Firebase 콘솔 > App Check에서 웹 앱을 등록하면 나온다. 공개 값이다. */
export const appCheckSiteKey = '6LfmX-stAAAAADZbgzP0jVYqzJVgqMIqNYogcDif';
