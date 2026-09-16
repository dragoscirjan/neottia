# {% block title %}{% endblock %}

## Purpose

{% block purpose %}{% endblock %}

## Required sequence

{% block sequence %}{% endblock %}

## Approval points

{% for point in command.approvalPoints %}- {{ point }}
{% endfor %}

## Stop conditions

{% for condition in command.stopConditions %}- {{ condition }}
{% endfor %}

## Compiled Issues instructions

{{ instructions.issues }}

## Compiled Documents instructions

{{ instructions.documents }}

## Compiled local source-control instructions

{{ instructions.sourceControl.local }}

## Compiled remote source-control instructions

{{ instructions.sourceControl.remote }}

## Role invocation

{% for role in roles %}### {{ role.id }}

{{ role.content }}

{% endfor %}## Permission boundary

These lifecycle instructions are guidance. They do not grant host permissions. Honor host-enforced restrictions and request approval where this command requires it.
