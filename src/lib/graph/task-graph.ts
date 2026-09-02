import { DirectedGraph } from "graphology";

import type { Task } from "@/lib/tarkovdev/types";

/**
 * Task dependency graph.
 *
 * Ported from TarkovTracker's `tarkov-tracker/src/composables/tarkovdata.js`, which
 * builds the same graph with graphology: a node per task, and an edge from each
 * prerequisite to the task that requires it, so a task's `inNeighbors` are its direct
 * prerequisites and its `outNeighbors` are what it unlocks.
 *
 * The one subtlety, also from TarkovTracker: a requirement with status `active` means the
 * prerequisite must be *in progress*, not finished. Drawing a direct edge would model that
 * as "must be done first", which is wrong. Instead the task inherits the prerequisite's own
 * predecessors, so it becomes reachable at the same point in the chain.
 */
export function buildTaskGraph(tasks: readonly Task[]): DirectedGraph {
  const graph = new DirectedGraph();
  const known = new Set(tasks.map((t) => t.id));

  for (const task of tasks) graph.mergeNode(task.id);

  // Pass 1: direct edges for everything except `active` requirements.
  const deferred: Array<{ taskId: string; requiredTaskId: string }> = [];
  for (const task of tasks) {
    for (const requirement of task.taskRequirements ?? []) {
      const requiredId = requirement.task?.id;
      // tarkov.dev occasionally references a task that is not in the task list
      // (removed or event-only). Skip rather than creating a dangling node.
      if (!requiredId || !known.has(requiredId)) continue;
      if (requirement.status?.includes("active")) {
        deferred.push({ taskId: task.id, requiredTaskId: requiredId });
      } else {
        graph.mergeEdge(requiredId, task.id);
      }
    }
  }

  // Pass 2: `active` requirements inherit the prerequisite's predecessors. Computed
  // against the pass-1 graph so the inheritance does not chase its own new edges.
  for (const { taskId, requiredTaskId } of deferred) {
    const inherited = graph.hasNode(requiredTaskId) ? graph.inNeighbors(requiredTaskId) : [];
    if (inherited.length === 0) continue;
    for (const ancestor of inherited) {
      if (ancestor !== taskId) graph.mergeEdge(ancestor, taskId);
    }
  }

  return graph;
}

function walk(graph: DirectedGraph, start: string, next: (node: string) => string[]): string[] {
  if (!graph.hasNode(start)) return [];
  const seen = new Set<string>();
  const stack = [...next(start)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === start || seen.has(node)) continue;
    seen.add(node);
    stack.push(...next(node));
  }
  return [...seen];
}

/** Every task that must come before this one, transitively. */
export function getPredecessors(graph: DirectedGraph, taskId: string): string[] {
  return walk(graph, taskId, (node) => graph.inNeighbors(node));
}

/** Every task this one eventually unlocks. */
export function getSuccessors(graph: DirectedGraph, taskId: string): string[] {
  return walk(graph, taskId, (node) => graph.outNeighbors(node));
}

/** Direct prerequisites only. */
export function getParents(graph: DirectedGraph, taskId: string): string[] {
  return graph.hasNode(taskId) ? graph.inNeighbors(taskId) : [];
}

/** Tasks directly unlocked by this one. */
export function getChildren(graph: DirectedGraph, taskId: string): string[] {
  return graph.hasNode(taskId) ? graph.outNeighbors(taskId) : [];
}
