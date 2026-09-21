import { describe, it, expect } from 'vitest';
import type { AiProvider } from '../../src/contexts/SettingsContext';
import { getProviderLabel } from '../../src/utils/settingsUI';
import { detectAIProviderFromKeys } from '../../src/utils/settings';

describe('Google Gemini AI Provider Integration', () => {
  describe('Provider type', () => {
    it('should accept gemini as a valid AiProvider', () => {
      const provider: AiProvider = 'gemini';
      expect(provider).toBe('gemini');
    });

    it('should be distinct from other providers', () => {
      const providers: AiProvider[] = [
        'openai',
        'anthropic',
        'gemini',
        'openrouter',
        'ollama',
        'custom-openai',
        'minimax',
      ];
      const unique = new Set(providers);
      expect(unique.size).toBe(providers.length);
    });
  });

  describe('Provider label', () => {
    it('should return Google Gemini label', () => {
      expect(getProviderLabel('gemini')).toBe('Google Gemini');
    });

    it('should not be confused with other providers', () => {
      expect(getProviderLabel('gemini')).not.toBe('OpenAI');
      expect(getProviderLabel('gemini')).not.toBe('Anthropic');
      expect(getProviderLabel('gemini')).not.toBe('MiniMax');
      expect(getProviderLabel('gemini')).not.toBe('OpenRouter');
    });
  });

  describe('Auto-detection priority', () => {
    it('should detect gemini when only gemini key is available', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        gemini: true,
        openrouter: false,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-2.5-flash');
    });

    it('should prefer openai over gemini', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: true,
        anthropic: false,
        gemini: true,
        openrouter: false,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        openai: ['gpt-5.5'],
        gemini: ['gemini-2.5-flash'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-5.5');
    });

    it('should prefer anthropic over gemini', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: true,
        gemini: true,
        openrouter: false,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        anthropic: ['claude-sonnet-4-6'],
        gemini: ['gemini-2.5-flash'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('anthropic');
      expect(result.model).toBe('claude-sonnet-4-6');
    });

    it('should prefer gemini over openrouter and minimax', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        gemini: true,
        openrouter: true,
        minimax: true,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        openrouter: ['openai/gpt-4o'],
        minimax: ['MiniMax-M3'],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-2.5-flash');
    });

    it('should return null model when gemini models list is empty', () => {
      const keyStatus: Record<AiProvider, boolean> = {
        openai: false,
        anthropic: false,
        gemini: true,
        openrouter: false,
        minimax: false,
        ollama: false,
        'custom-openai': false,
      };
      const models: Record<string, string[]> = {
        gemini: [],
      };

      const result = detectAIProviderFromKeys(keyStatus, models);
      expect(result.provider).toBe('gemini');
      expect(result.model).toBeNull();
    });
  });
});
