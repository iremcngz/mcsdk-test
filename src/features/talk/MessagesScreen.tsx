import React, { useState, useRef, useMemo } from 'react';
import {
  Alert,
  FlatList,
  Image,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
} from 'react-native';
import { useAppContext } from '../../contexts/AppContext';
import { makeMessagesStyles } from './messagesStyles';

interface Attachment {
  uri: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  type: 'image' | 'file';
}

interface Message {
  id: string;
  text: string;
  msgType: 'text' | 'image' | 'file';
  timestamp: Date;
  isOwn: boolean;
  attachment?: Attachment;
}

interface MessagesScreenProps {
  group: string;
  onClose: () => void;
}

export function MessagesScreen({ group, onClose }: MessagesScreenProps) {
  const { c, tr } = useAppContext();
  const styles = useMemo(() => makeMessagesStyles(c), [c]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const addMessage = (msg: Message) => {
    setMessages(prev => [...prev, msg]);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 150);
  };

  const sendTextMessage = () => {
    const text = inputText.trim();
    if (!text) return;
    addMessage({
      id: Date.now().toString(),
      text,
      msgType: 'text',
      timestamp: new Date(),
      isOwn: true,
    });
    setInputText('');
  };

  const nativeImagePicker = NativeModules.ImagePicker;
  const nativeDocPicker = NativeModules.RNDocumentPicker;

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'This app needs camera access to take photos.',
          buttonPositive: 'Allow',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const handleCamera = async () => {
    if (!nativeImagePicker?.launchCamera) {
      Alert.alert('Not Available', 'Camera module is linked, rebuild the app.');
      return;
    }
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Camera access is required.');
      return;
    }
    nativeImagePicker.launchCamera(
      { mediaType: 'photo', saveToPhotos: false, quality: 0.8 },
      (response: any) => {
        if (response.didCancel || response.errorCode) return;
        const asset = response.assets?.[0];
        if (!asset?.uri) return;
        addMessage({
          id: Date.now().toString(),
          text: '📷 Photo',
          msgType: 'image',
          timestamp: new Date(),
          isOwn: true,
          attachment: {
            uri: asset.uri,
            fileName: asset.fileName ?? 'photo.jpg',
            fileSize: asset.fileSize,
            mimeType: asset.type,
            type: 'image',
          },
        });
      },
    );
  };

  const handleImagePicker = () => {
    if (!nativeImagePicker?.launchImageLibrary) {
      Alert.alert('Not Available', 'Image picker module is not available, rebuild the app.');
      return;
    }
    nativeImagePicker.launchImageLibrary(
      { mediaType: 'photo', quality: 0.8, selectionLimit: 1 },
      (response: any) => {
        if (response.didCancel || response.errorCode) return;
        const asset = response.assets?.[0];
        if (!asset?.uri) return;
        addMessage({
          id: Date.now().toString(),
          text: '🖼️ Image',
          msgType: 'image',
          timestamp: new Date(),
          isOwn: true,
          attachment: {
            uri: asset.uri,
            fileName: asset.fileName ?? 'image.jpg',
            fileSize: asset.fileSize,
            mimeType: asset.type,
            type: 'image',
          },
        });
      },
    );
  };

  const handleFilePicker = async () => {
    if (!nativeDocPicker?.pick) {
      Alert.alert('Not Available', 'File picker module is not available, rebuild the app.');
      return;
    }
    try {
      const results = await nativeDocPicker.pick({
        type: ['public.item'],
        copyTo: 'cachesDirectory',
      });
      const file = results?.[0];
      if (!file?.uri) return;
      addMessage({
        id: Date.now().toString(),
        text: file.fileName ?? 'File',
        msgType: 'file',
        timestamp: new Date(),
        isOwn: true,
        attachment: {
          uri: file.uri,
          fileName: file.fileName ?? 'file',
          fileSize: file.fileSize,
          mimeType: file.type,
          type: 'file',
        },
      });
    } catch (err: any) {
      if (String(err).includes('cancel') || String(err).includes('CANCELED')) return;
      Alert.alert('Error', 'Failed to pick document.');
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.msgBubble, item.isOwn ? styles.msgOwn : styles.msgOther]}>
      {item.msgType === 'image' && item.attachment?.uri ? (
        <Image
          source={{ uri: item.attachment.uri }}
          style={styles.msgImage}
          resizeMode="cover"
        />
      ) : item.msgType === 'file' ? (
        <View style={styles.fileAttach}>
          <Text style={styles.fileIcon}>📎</Text>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>
              {item.attachment?.fileName ?? item.text}
            </Text>
            {item.attachment?.fileSize ? (
              <Text style={styles.fileSize}>{formatFileSize(item.attachment.fileSize)}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <Text style={styles.msgText}>{item.text}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.8}
          style={styles.backButton}
          testID="messages-back">
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{tr.talkMessagesTitle}</Text>
          <Text style={styles.headerGroup}>{group}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{tr.talkMessagesEmpty}</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          style={styles.list}
        />
      )}

      <View style={styles.inputBar}>
        <TouchableOpacity
          onPress={handleCamera}
          activeOpacity={0.7}
          style={styles.attachButton}
          testID="messages-attach-camera">
          <Text style={styles.attachIcon}>📷</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleImagePicker}
          activeOpacity={0.7}
          style={styles.attachButton}
          testID="messages-attach-image">
          <Text style={styles.attachIcon}>🖼️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleFilePicker}
          activeOpacity={0.7}
          style={styles.attachButton}
          testID="messages-attach-file">
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder={tr.talkMessagesInputPlaceholder}
          placeholderTextColor={c.textMuted}
          testID="messages-input"
        />
        <TouchableOpacity
          onPress={sendTextMessage}
          activeOpacity={0.7}
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          disabled={!inputText.trim()}
          testID="messages-send">
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
