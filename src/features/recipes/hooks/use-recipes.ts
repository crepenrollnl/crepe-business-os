"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { recipeService } from "../services/recipe-service";
import { recipePhotoService } from "../services/recipe-photo-service";
import type {
  ComponentRecipeOption,
  RecipeFormValues,
  RecipeIngredientOption,
  RecipePhotoSaveIntent,
  RecipeListItem,
  RecipeSortDirection,
  RecipeSortField,
  RecipeWithRelations,
} from "../types/recipe";
import {
  DEFAULT_RECIPE_ROLE,
  DEFAULT_RECIPE_YIELD_UNIT,
  isRecipeYieldUnit,
} from "../types/recipe";

function compareRecipes(
  a: RecipeListItem,
  b: RecipeListItem,
  sortField: RecipeSortField,
  sortDirection: RecipeSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "yield_quantity") {
    return (a.yield_quantity - b.yield_quantity) * direction;
  }

  if (sortField === "item_count") {
    return (a.item_count - b.item_count) * direction;
  }

  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction
  );
}

async function fetchRecipesState() {
  const [recipesResult, ingredientsResult, componentRecipesResult] =
    await Promise.all([
      recipeService.getRecipes(),
      recipeService.getIngredients(),
      recipeService.getComponentRecipes(),
    ]);

  return {
    items: recipesResult.error ? [] : (recipesResult.data ?? []),
    ingredients: ingredientsResult.error ? [] : (ingredientsResult.data ?? []),
    componentRecipes: componentRecipesResult.error
      ? []
      : (componentRecipesResult.data ?? []),
    error:
      recipesResult.error ??
      ingredientsResult.error ??
      componentRecipesResult.error ??
      null,
  };
}

function emptyFormValues(): RecipeFormValues {
  return {
    name: "",
    description: "",
    yield_quantity: null,
    yield_unit: DEFAULT_RECIPE_YIELD_UNIT,
    is_active: true,
    recipe_role: DEFAULT_RECIPE_ROLE,
    selling_price: null,
    image_url: null,
    lines: [{ ingredient_id: "", quantity: null, unit: "" }],
    components: [
      { component_recipe_id: null, ingredient_id: null, quantity: null, unit: "" },
    ],
  };
}

function recipeToFormValues(recipe: RecipeWithRelations): RecipeFormValues {
  return {
    name: recipe.name,
    description: recipe.description ?? "",
    yield_quantity: recipe.yield_quantity,
    yield_unit: isRecipeYieldUnit(recipe.yield_unit)
      ? recipe.yield_unit
      : DEFAULT_RECIPE_YIELD_UNIT,
    is_active: recipe.is_active,
    recipe_role: recipe.recipe_role,
    selling_price: recipe.selling_price,
    image_url: recipe.image_url,
    lines:
      recipe.items.length > 0
        ? recipe.items.map((item) => ({
            ingredient_id: item.ingredient_id,
            quantity: item.quantity,
            unit: item.unit,
          }))
        : [{ ingredient_id: "", quantity: null, unit: "" }],
    components:
      recipe.components.length > 0
        ? recipe.components.map((component) => ({
            component_recipe_id: component.component_recipe_id,
            ingredient_id: component.ingredient_id,
            quantity: component.quantity,
            unit: component.unit,
          }))
        : // Assembly recipes always require at least one component, so this
          // blank starter row is what the "Add at least one component"
          // guidance is for. Component recipes' sub-components are
          // optional (most have none) — starting with a real empty list
          // means opening an existing Component recipe for editing never
          // surfaces a phantom unfilled row that would block saving.
          recipe.recipe_role === "component"
          ? []
          : [
              {
                component_recipe_id: null,
                ingredient_id: null,
                quantity: null,
                unit: "",
              },
            ],
  };
}

export function useRecipes() {
  const [items, setItems] = useState<RecipeListItem[]>([]);
  const [ingredients, setIngredients] = useState<RecipeIngredientOption[]>([]);
  const [componentRecipes, setComponentRecipes] = useState<
    ComponentRecipeOption[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<RecipeSortField>("name");
  const [sortDirection, setSortDirection] =
    useState<RecipeSortDirection>("asc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] =
    useState<RecipeWithRelations | null>(null);
  const [isLoadingRecipe, setIsLoadingRecipe] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [viewingRecipe, setViewingRecipe] =
    useState<RecipeWithRelations | null>(null);
  const [isLoadingViewRecipe, setIsLoadingViewRecipe] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecipeListItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchRecipesState>>) => {
      setItems(state.items);
      setIngredients(state.ingredients);
      setComponentRecipes(state.componentRecipes);
      setError(state.error);
    },
    [],
  );

  const loadRecipes = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchRecipesState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchRecipesState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (normalizedSearch.length === 0) {
        return true;
      }

      return item.name.toLowerCase().includes(normalizedSearch);
    });

    return [...filtered].sort((a, b) =>
      compareRecipes(a, b, sortField, sortDirection),
    );
  }, [items, search, sortField, sortDirection]);

  const hasActiveFilters = search.trim().length > 0;

  const toggleSort = useCallback(
    (field: RecipeSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection("asc");
    },
    [sortField],
  );

  const openCreateModal = useCallback(() => {
    setEditingRecipe(null);
    setActionError(null);
    setPhotoError(null);
    setIsLoadingRecipe(false);
    setIsModalOpen(true);
  }, []);

  // Only `.id` is ever read -- {id: string} rather than the full
  // RecipeListItem so the View modal's "Edit" handoff can call this with
  // just the id of the recipe it already has loaded, no cast needed.
  const openEditModal = useCallback(async (item: { id: string }) => {
    setActionError(null);
    setPhotoError(null);
    setEditingRecipe(null);
    setIsLoadingRecipe(true);
    setIsModalOpen(true);

    const result = await recipeService.getRecipe(item.id);

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to load recipe");
      setEditingRecipe(null);
      setIsLoadingRecipe(false);
      return;
    }

    setEditingRecipe(result.data);
    setIsLoadingRecipe(false);
  }, []);

  const closeModal = useCallback(() => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingRecipe(null);
    setActionError(null);
    setPhotoError(null);
    setIsLoadingRecipe(false);
  }, [isSaving]);

  // Read-only quick look (recipes list "View"). Same fetch as Edit
  // (recipeService.getRecipe -> RecipeWithRelations, already resolves
  // ingredient/component names via enrichRecipe) -- nothing new queried.
  const openViewModal = useCallback(async (item: RecipeListItem) => {
    setViewError(null);
    setViewingRecipe(null);
    setIsLoadingViewRecipe(true);
    setIsViewModalOpen(true);

    const result = await recipeService.getRecipe(item.id);

    if (result.error || !result.data) {
      setViewError(result.error ?? "Failed to load recipe");
      setViewingRecipe(null);
      setIsLoadingViewRecipe(false);
      return;
    }

    setViewingRecipe(result.data);
    setIsLoadingViewRecipe(false);
  }, []);

  const closeViewModal = useCallback(() => {
    setIsViewModalOpen(false);
    setViewingRecipe(null);
    setViewError(null);
    setIsLoadingViewRecipe(false);
  }, []);

  const editFromView = useCallback(() => {
    if (!viewingRecipe) {
      return;
    }

    const id = viewingRecipe.id;
    closeViewModal();
    void openEditModal({ id });
  }, [closeViewModal, openEditModal, viewingRecipe]);

  const openDeleteDialog = useCallback((item: RecipeListItem) => {
    setDeleteTarget(item);
    setActionError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
    setActionError(null);
  }, []);

  const saveRecipe = useCallback(
    async (
      values: RecipeFormValues,
      photo: RecipePhotoSaveIntent = { file: null, clear: false },
    ) => {
      setIsSaving(true);
      setActionError(null);
      setPhotoError(null);

      const previousUrl = editingRecipe?.image_url ?? null;
      const PHOTO_SAVE_WARNING =
        "Recipe saved, but the photo could not be uploaded.";

      if (!editingRecipe) {
        const created = await recipeService.createRecipe({
          ...values,
          image_url: null,
        });

        if (created.error || !created.data) {
          setActionError(created.error ?? "Failed to create recipe");
          setIsSaving(false);
          return false;
        }

        if (photo.file) {
          const uploaded = await recipePhotoService.uploadPhoto(
            created.data.id,
            photo.file,
          );

          if (uploaded.error || !uploaded.data) {
            setPhotoError(
              `${PHOTO_SAVE_WARNING} ${uploaded.error ?? "Upload failed."}`,
            );
            setEditingRecipe(created.data);
            await loadRecipes({ silent: true });
            setIsSaving(false);
            return false;
          }

          const linked = await recipeService.updateRecipeImageUrl(
            created.data.id,
            uploaded.data.url,
          );

          if (linked.error) {
            setPhotoError(`${PHOTO_SAVE_WARNING} ${linked.error}`);
            setEditingRecipe({
              ...created.data,
              image_url: uploaded.data.url,
            });
            await loadRecipes({ silent: true });
            setIsSaving(false);
            return false;
          }
        }

        await loadRecipes({ silent: true });
        setIsSaving(false);
        closeModal();
        return true;
      }

      let nextImageUrl = previousUrl;

      if (photo.clear && !photo.file) {
        nextImageUrl = null;
      }

      if (photo.file) {
        const uploaded = await recipePhotoService.uploadPhoto(
          editingRecipe.id,
          photo.file,
        );

        if (uploaded.error || !uploaded.data) {
          const persisted = await recipeService.updateRecipe(editingRecipe.id, {
            ...values,
            image_url: previousUrl,
          });

          if (persisted.error) {
            setActionError(persisted.error);
            setIsSaving(false);
            return false;
          }

          setPhotoError(
            `${PHOTO_SAVE_WARNING} ${uploaded.error ?? "Upload failed."}`,
          );
          await loadRecipes({ silent: true });
          setIsSaving(false);
          return false;
        }

        nextImageUrl = uploaded.data.url;
      }

      const result = await recipeService.updateRecipe(editingRecipe.id, {
        ...values,
        image_url: nextImageUrl,
      });

      if (result.error) {
        setActionError(result.error);
        setIsSaving(false);
        return false;
      }

      if (photo.clear && previousUrl) {
        await recipePhotoService.removePhotoByUrl(previousUrl);
      } else if (
        photo.file &&
        previousUrl &&
        nextImageUrl &&
        previousUrl !== nextImageUrl
      ) {
        await recipePhotoService.removePhotoByUrl(previousUrl);
      }

      await loadRecipes({ silent: true });
      setIsSaving(false);
      closeModal();
      return true;
    },
    [closeModal, editingRecipe, loadRecipes],
  );

  const deleteRecipe = useCallback(async () => {
    if (!deleteTarget) {
      return false;
    }

    setIsDeleting(true);
    setActionError(null);

    const result = await recipeService.deleteRecipe(deleteTarget.id);

    if (result.error) {
      setActionError(result.error);
      setIsDeleting(false);
      return false;
    }

    await loadRecipes({ silent: true });
    setIsDeleting(false);
    closeDeleteDialog();
    return true;
  }, [closeDeleteDialog, deleteTarget, loadRecipes]);

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters,
    ingredients,
    componentRecipes,
    loading,
    error,
    search,
    setSearch,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingRecipe,
    initialFormValues: editingRecipe
      ? recipeToFormValues(editingRecipe)
      : emptyFormValues(),
    isLoadingRecipe,
    isViewModalOpen,
    viewingRecipe,
    isLoadingViewRecipe,
    viewError,
    deleteTarget,
    isSaving,
    isDeleting,
    actionError,
    photoError,
    openCreateModal,
    openEditModal,
    closeModal,
    openViewModal,
    closeViewModal,
    editFromView,
    openDeleteDialog,
    closeDeleteDialog,
    saveRecipe,
    deleteRecipe,
    retry: () => loadRecipes(),
  };
}
