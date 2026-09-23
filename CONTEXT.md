# Agent-stack assurance context

This glossary defines the product concepts used to describe project capabilities and their controlled release.

## Language

**Capability**:
An independently meaningful behavior that a project provides and records in its inventory.
_Avoid_: Feature flag

**Rollout**:
An optional control attached to one capability that determines when and for whom that capability is available.
_Avoid_: Capability

**Feature flag**:
A named runtime decision that returns a typed value for a given evaluation context.
_Avoid_: Capability

**Evaluation context**:
The user, organization, or other subject attributes used to evaluate a feature flag.
_Avoid_: Flag configuration
