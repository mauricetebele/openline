import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'authToken'
const ACCOUNT_KEY = 'selectedAccountId'

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY)
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

export async function getSelectedAccountId(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCOUNT_KEY)
}

export async function setSelectedAccountId(id: string): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_KEY, id)
}
