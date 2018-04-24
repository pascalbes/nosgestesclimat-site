import { head, pathOr, without, concat, path, length, reject } from 'ramda'
import { combineReducers } from 'redux'
import reduceReducers from 'reduce-reducers'
import { reducer as formReducer, formValueSelector } from 'redux-form'

import { rules, collectDefaults, formatInputs, rulesFr } from 'Engine/rules'
import {
	getNextSteps,
	collectMissingVariablesByTarget
} from 'Engine/generateQuestions'
import computeThemeColours from 'Components/themeColours'
import {
	STEP_ACTION,
	EXPLAIN_VARIABLE,
	CHANGE_THEME_COLOUR,
	CHANGE_LANG
} from './actions'

import { analyseMany, parseAll } from 'Engine/traverse'

import ReactPiwik from 'Components/Tracker'

import { popularTargetNames } from './components/TargetSelection'

// assume "wraps" a given situation function with one that overrides its values with
// the given assumptions
export let assume = (evaluator, assumptions) => state => name => {
	let userInput = evaluator(state)(name)
	return userInput != null ? userInput : assumptions[name]
}

export let reduceSteps = (tracker, flatRules, answerSource) => (
	state,
	action
) => {
	state.flatRules = flatRules
	// Optimization - don't parse on each analysis
	if (!state.parsedRules) {
		state.parsedRules = parseAll(flatRules)
	}

	// TODO
	if (action.type == CHANGE_LANG) {
		if (action.lang == 'fr') {
			flatRules = rulesFr
		} else flatRules = rules
		return {
			...state,
			flatRules
		}
	}

	if (
		![
			'SET_CONVERSATION_TARGETS',
			STEP_ACTION,
			'USER_INPUT_UPDATE',
			'START_CONVERSATION'
		].includes(action.type)
	)
		return state

	if (path(['form', 'conversation', 'syncErrors'], state)) return state

	let targetNames = reject(
		name => state.activeTargetInput && state.activeTargetInput.includes(name)
	)(state.targetNames)

	// Most rules have default values
	let rulesDefaults = collectDefaults(flatRules),
		situationWithDefaults = assume(answerSource, rulesDefaults)

	let analysis = analyseMany(state.parsedRules, targetNames)(
		situationWithDefaults(state)
	)

	if (action.type === 'USER_INPUT_UPDATE') {
		return { ...state, analysis, situationGate: situationWithDefaults(state) }
	}

	let nextStepsAnalysis = analyseMany(state.parsedRules, targetNames)(
			answerSource(state)
		),
		missingVariablesByTarget = collectMissingVariablesByTarget(
			nextStepsAnalysis.targets
		),
		nextSteps = getNextSteps(missingVariablesByTarget)

	let newState = {
		...state,
		analysis,
		situationGate: situationWithDefaults(state),
		explainedVariable: null,
		nextSteps,
		// store the missingVariables when no question has been answered yet,
		// to be able to compute a progress by objective
		missingVariablesByTarget: {
			initial:
				state.foldedSteps.length === 0
					? missingVariablesByTarget
					: state.missingVariablesByTarget.initial,
			current: missingVariablesByTarget
		},
		currentQuestion: head(nextSteps),
		foldedSteps:
			action.type === 'SET_CONVERSATION_TARGETS' && action.reset
				? []
				: state.foldedSteps
	}

	if (action.type == 'START_CONVERSATION') return newState

	if (action.type == STEP_ACTION && action.name == 'fold') {
		tracker.push([
			'trackEvent',
			'answer:' + action.source,
			action.step + ': ' + situationWithDefaults(state)(action.step)
		])

		if (!newState.currentQuestion) {
			tracker.push([
				'trackEvent',
				'done',
				'after' + length(newState.foldedSteps) + 'questions'
			])
		}

		return {
			...newState,
			foldedSteps: [...state.foldedSteps, state.currentQuestion]
		}
	}
	if (action.type == STEP_ACTION && action.name == 'unfold') {
		tracker.push(['trackEvent', 'unfold', action.step])

		// We are possibly "refolding" a previously open question
		let previous = state.currentQuestion,
			// we fold it back into foldedSteps if it had been answered
			answered = previous && answerSource(state)(previous) != undefined,
			foldedSteps = answered
				? concat(state.foldedSteps, [previous])
				: state.foldedSteps

		return {
			...newState,
			foldedSteps: without([action.step], foldedSteps),
			currentQuestion: action.step
		}
	}
}

function themeColours(state = computeThemeColours(), { type, colour }) {
	if (type == CHANGE_THEME_COLOUR) return computeThemeColours(colour)
	else return state
}

function explainedVariable(state = null, { type, variableName = null }) {
	switch (type) {
		case EXPLAIN_VARIABLE:
			return variableName
		default:
			return state
	}
}

function currentExample(state = null, { type, situation, name }) {
	switch (type) {
		case 'SET_EXAMPLE':
			return name != null ? { name, situation } : null
		default:
			return state
	}
}

function conversationStarted(state = false, { type }) {
	switch (type) {
		case 'START_CONVERSATION':
			return true
		default:
			return state
	}
}
function activeTargetInput(state = null, { type, name }) {
	switch (type) {
		case 'SET_ACTIVE_TARGET_INPUT':
			return name
		default:
			return state
	}
}

export default initialRules =>
	reduceReducers(
		combineReducers({
			sessionId: (id = Math.floor(Math.random() * 1000000000000) + '') => id,
			//  this is handled by redux-form, pas touche !
			form: formReducer,

			/* Have forms been filled or ignored ?
		false means the user is reconsidering its previous input */
			foldedSteps: (steps = []) => steps,
			currentQuestion: (state = null) => state,
			nextSteps: (state = []) => state,
			missingVariablesByTarget: (state = {}) => state,

			parsedRules: (state = null) => state,
			flatRules: (state = null) => state,
			analysis: (state = null) => state,

			targetNames: (state = popularTargetNames) => state,

			situationGate: (state = name => null) => state,

			iframe: (state = false) => state,

			themeColours,

			explainedVariable,

			currentExample,
			conversationStarted,
			activeTargetInput
		}),
		// cross-cutting concerns because here `state` is the whole state tree
		reduceSteps(
			ReactPiwik,
			initialRules,
			formatInputs(initialRules, formValueSelector)
		)
	)
