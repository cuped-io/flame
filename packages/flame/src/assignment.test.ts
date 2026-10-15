import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUserId, getAssignedVariant } from './assignment';
import type { Experiment, StoredAssignment, Variant } from './types';

describe('assignment', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('getUserId', () => {
    it('should generate a new user ID when none exists', () => {
      const userId = getUserId();
      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');
      expect(userId.length).toBeGreaterThan(0);
    });

    it('should return the same user ID on subsequent calls', () => {
      const userId1 = getUserId();
      const userId2 = getUserId();
      expect(userId1).toBe(userId2);
    });

    it('should persist user ID in localStorage', () => {
      const userId = getUserId();
      const stored = localStorage.getItem('flame_device_id');
      expect(stored).toBe(userId);
    });

    it('should return existing user ID from localStorage', () => {
      const existingId = 'existing-user-id-123';
      localStorage.setItem('flame_device_id', existingId);
      const userId = getUserId();
      expect(userId).toBe(existingId);
    });

    it('should generate UUID-like format', () => {
      const userId = getUserId();
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(userId).toMatch(uuidRegex);
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw errors (simulating private browsing)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      // Should still return a valid user ID (session-only)
      const userId = getUserId();
      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');
    });
  });

  describe('getAssignedVariant', () => {
    const mockVariant1: Variant = {
      id: 'variant-1',
      experiment_id: 'exp-1',
      name: 'Control',
      description: null,
      is_control: true,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    const mockVariant2: Variant = {
      id: 'variant-2',
      experiment_id: 'exp-1',
      name: 'Treatment',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    };

    const mockExperiment: Experiment = {
      id: 'exp-1',
      project_id: 'proj-1',
      name: 'Test Experiment',
      description: null,
      status: 'running',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      variants: [mockVariant1, mockVariant2],
    };

    it('should return the assigned variant', () => {
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-2',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      const variant = getAssignedVariant(mockExperiment, assignment);
      expect(variant).toEqual(mockVariant2);
    });

    it('should return undefined when variant not found', () => {
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'nonexistent',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      const variant = getAssignedVariant(mockExperiment, assignment);
      expect(variant).toBeUndefined();
    });

    it('should return undefined when experiment has no variants', () => {
      const experimentWithoutVariants: Experiment = {
        ...mockExperiment,
        variants: undefined,
      };
      const assignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };

      const variant = getAssignedVariant(experimentWithoutVariants, assignment);
      expect(variant).toBeUndefined();
    });
  });
});
