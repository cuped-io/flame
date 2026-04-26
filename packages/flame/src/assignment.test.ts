import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUserId, getOrCreateAssignment, getAssignedVariant } from './assignment';
import type { Experiment, StoredAssignment, Variant } from './types';
import type { ApiClient } from './api';

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

  describe('getOrCreateAssignment', () => {
    const mockVariant: Variant = {
      id: 'variant-1',
      experiment_id: 'exp-1',
      name: 'Control',
      description: null,
      is_control: true,
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
      variants: [mockVariant],
    };

    const createMockApiClient = (assignmentResponse: Partial<ReturnType<typeof vi.fn>>) => {
      return {
        assignVariant: vi.fn().mockResolvedValue({
          assignment_id: 'assign-1',
          experiment_id: 'exp-1',
          variant_id: 'variant-1',
          variant_name: 'Control',
          is_control: true,
          assigned_at: '2024-01-01T00:00:00Z',
          ...assignmentResponse,
        }),
      } as unknown as ApiClient;
    };

    it('should fetch new assignment from API when none exists', async () => {
      const mockApiClient = createMockApiClient({});
      const userId = 'user-123';

      const assignment = await getOrCreateAssignment(mockExperiment, userId, mockApiClient);

      expect(mockApiClient.assignVariant).toHaveBeenCalledWith(
        'exp-1',
        userId,
        undefined,
        undefined
      );
      expect(assignment.experimentId).toBe('exp-1');
      expect(assignment.variantId).toBe('variant-1');
      expect(assignment.userId).toBe(userId);
    });

    it('should store assignment in localStorage', async () => {
      const mockApiClient = createMockApiClient({});
      const userId = 'user-123';

      await getOrCreateAssignment(mockExperiment, userId, mockApiClient);

      const stored = localStorage.getItem('flame_assignments');
      expect(stored).toBeDefined();
      const assignments = JSON.parse(stored!);
      expect(assignments['exp-1']).toBeDefined();
      expect(assignments['exp-1'].variantId).toBe('variant-1');
    });

    it('should return existing assignment from localStorage', async () => {
      const existingAssignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'variant-1',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      localStorage.setItem('flame_assignments', JSON.stringify({ 'exp-1': existingAssignment }));

      const mockApiClient = createMockApiClient({});
      const assignment = await getOrCreateAssignment(mockExperiment, 'user-123', mockApiClient);

      // Should NOT call the API
      expect(mockApiClient.assignVariant).not.toHaveBeenCalled();
      expect(assignment).toEqual(existingAssignment);
    });

    it('should fetch new assignment when stored variant no longer exists', async () => {
      // Store assignment for a variant that no longer exists
      const oldAssignment: StoredAssignment = {
        experimentId: 'exp-1',
        variantId: 'deleted-variant',
        userId: 'user-123',
        assignedAt: '2024-01-01T00:00:00Z',
      };
      localStorage.setItem('flame_assignments', JSON.stringify({ 'exp-1': oldAssignment }));

      const mockApiClient = createMockApiClient({});
      const assignment = await getOrCreateAssignment(mockExperiment, 'user-123', mockApiClient);

      // Should call the API to get a new assignment
      expect(mockApiClient.assignVariant).toHaveBeenCalled();
      expect(assignment.variantId).toBe('variant-1');
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
