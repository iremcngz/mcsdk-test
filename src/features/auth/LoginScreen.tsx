/**
 * features/auth/LoginScreen.tsx — Full-screen login gate shown at startup
 * when the user is not authenticated.
 *
 * First login with a username registers it; subsequent logins verify the
 * stored password hash.  Wrong password shows an error inline.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';

export default function LoginScreen() {
  const { c, tr, login } = useAppContext();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const s = useMemo(() => makeStyles(c), [c]);

  async function handleLogin() {
    if (loading) { return; }
    setError(null);
    setLoading(true);
    try {
      const result = await login(username, password);
      if (!result) {
        setError(tr.loginError);
      }
      // On true, AppContext sets isLoggedIn=true → AppGate unmounts this screen.
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.root}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.center}>
          <View style={s.card}>
            <Text style={s.title}>{tr.loginTitle}</Text>

            <TextInput
              style={s.input}
              placeholder={tr.inputUsername}
              placeholderTextColor={c.textMuted}
              value={username}
              onChangeText={v => { setUsername(v); setError(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />

            <TextInput
              style={s.input}
              placeholder={tr.inputPassword}
              placeholderTextColor={c.textMuted}
              value={password}
              onChangeText={v => { setPassword(v); setError(null); }}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            {error && (
              <Text style={s.errorText}>{error}</Text>
            )}

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleLogin}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={c.textOnAccent} />
                : <Text style={s.btnText}>{tr.btnLogin}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof import('../../core/theme').getThemePalette>) {
  return StyleSheet.create({
    root:      { flex: 1, backgroundColor: c.bg },
    flex:      { flex: 1 },
    center:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: 24,
      borderWidth: 1,
      borderColor: c.border,
    },
    title: {
      fontSize: 22,
      fontWeight: '700',
      color: c.accent,
      marginBottom: 20,
      textAlign: 'center',
    },
    input: {
      backgroundColor: c.inputBg,
      color: c.textPrimary,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: Platform.OS === 'ios' ? 12 : 8,
      fontSize: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.border,
    },
    errorText: {
      color: c.error,
      fontSize: 12,
      marginBottom: 10,
      textAlign: 'center',
    },
    btn: {
      backgroundColor: c.accent,
      borderRadius: 8,
      paddingVertical: 13,
      alignItems: 'center',
      marginTop: 4,
    },
    btnText: {
      color: c.textOnAccent,
      fontWeight: '700',
      fontSize: 15,
    },
    btnDisabled: { opacity: 0.6 },
  });
}
