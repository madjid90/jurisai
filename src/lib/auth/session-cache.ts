let validatedAccessToken: string | null = null;

export function getValidatedAccessToken() {
  return validatedAccessToken;
}

export function setValidatedAccessToken(token: string | null) {
  validatedAccessToken = token;
}