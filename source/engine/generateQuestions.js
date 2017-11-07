import React from 'react'
import R from 'ramda'

import Explicable from 'Components/conversation/Explicable'
import Question from 'Components/conversation/Question'
import Input from 'Components/conversation/Input'
import Select from 'Components/conversation/select/Select'
import SelectAtmp from 'Components/conversation/select/SelectTauxRisque'
import formValueTypes from 'Components/conversation/formValueTypes'

import {findInversion} from './traverse'
import {findRuleByDottedName} from './rules'
import {collectNodeMissing, evaluateNode} from './evaluation'

/*
	COLLECTE DES VARIABLES MANQUANTES
	*********************************
	on collecte les variables manquantes : celles qui sont nécessaires pour
	remplir les objectifs de la simulation (calculer des cotisations) mais qui n'ont pas
	encore été renseignées

	TODO perf : peut-on le faire en même temps que l'on traverse l'AST ?
	Oui sûrement, cette liste se complète en remontant l'arbre. En fait, on le fait déjà pour nodeValue,
	et quand nodeValue vaut null, c'est qu'il y a des missingVariables ! Il suffit donc de remplacer les
	null par un tableau, et d'ailleurs utiliser des fonction d'aide pour mutualiser ces tests.

	missingVariables: {variable: [objectives]}
 */

// On peut travailler sur une somme, les objectifs sont alors les variables de cette somme.
// Ou sur une variable unique ayant une formule ou une conodition 'non applicable si', elle est elle-même le seul objectif
export let getObjectives = (situationGate, root, parsedRules) => {
	let formuleType = R.path(["formule", "explanation", "name"])(root)

	let targets = formuleType == "somme"
		? R.pluck(
				"dottedName",
				R.path(["formule", "explanation", "explanation"])(root)
			)
		: (root.formule || root['non applicable si'] || root['applicable si']) ? [root.dottedName] : null,
		names = targets ? R.reject(R.isNil)(targets) : []

	let inversion = findInversion(situationGate, parsedRules, root)

	if (inversion){
		return [evaluateNode(situationGate, parsedRules, inversion.fixedObjectiveRule)]
	}

	let findAndEvaluate = name => evaluateNode(situationGate,parsedRules,findRuleByDottedName(parsedRules,name))

	return R.map(findAndEvaluate,names)
}

export let collectMissingVariables = (groupMethod='groupByMissingVariable') => (situationGate, {root, parsedRules}) => {
	return R.pipe(
		R.curry(getObjectives)(situationGate),
		R.chain( v =>
			R.pipe(
				collectNodeMissing,
				R.flatten,
				R.map(mv => [v.dottedName, mv])
			)(v)
		),
		//groupBy missing variable but remove mv from value, it's now in the key
		R.groupBy(groupMethod == 'groupByMissingVariable' ? R.last : R.head),
		R.map(R.map(groupMethod == 'groupByMissingVariable' ? R.head : R.last))
		// below is a hand implementation of above... function composition can be nice sometimes :')
		// R.reduce( (memo, [mv, dependencyOf]) => ({...memo, [mv]: [...(memo[mv] || []), dependencyOf] }), {})
	)(root, parsedRules)
}

export let nextSteps = (situationGate, flatRules, analysedSituation) => {
	let impact = ([variable, objectives]) => R.length(objectives)

	let missingVariables = collectMissingVariables('groupByMissingVariable')(situationGate, analysedSituation),
		pairs = R.toPairs(missingVariables),
		sortedPairs = R.sort(R.descend(impact), pairs)

	return R.map(R.head, sortedPairs)
}

export let constructStepMeta = ({
	titre,
	question,
	subquestion,
	dottedName,
	name,
}) => ({
	// name: dottedName.split(' . ').join('.'),
	name: dottedName,
	// <Explicable/> ajoutera une aide au clic sur un icône [?]
	// Son texte est la question s'il y en a une à poser. Sinon on prend le titre.
	question: (
		<Explicable label={question || name} dottedName={dottedName} lightBackground={true} />
	),
	title: titre || name,
	subquestion,

	// Legacy properties :

	visible: true,
	// helpText: 'Voila un peu d\'aide poto'
})

let isVariant = R.path(['formule', 'une possibilité'])

let buildVariantTree = (allRules, path) => {
	let rec = path => {
		let node = findRuleByDottedName(allRules, path),
			variant = isVariant(node),
			variants = variant && R.unless(R.is(Array), R.prop('possibilités'))(variant),
			shouldBeExpanded = variant && true, //variants.find( v => relevantPaths.find(rp => R.contains(path + ' . ' + v)(rp) )),
			canGiveUp = variant && !variant['choix obligatoire']

		return Object.assign(
			node,
			shouldBeExpanded ?
				{	canGiveUp,
					children: variants.map(v => rec(path + ' . ' + v))
				}
			: null
		)
	}
	return rec(path)
}

export let makeQuestion = flatRules => dottedName => {
	let rule = findRuleByDottedName(flatRules, dottedName)

	let inputQuestion = rule => ({
			component: Input,
			valueType: formValueTypes[rule.format],
			attributes: {
				inputMode: 'numeric',
				placeholder: 'votre réponse',
			},
			suggestions: rule.suggestions,
		})
	let selectQuestion = rule => ({
			component: Select,
			valueType: formValueTypes[rule.format],
			suggestions: rule.suggestions,
		})
	let selectAtmp = rule => ({
			component: SelectAtmp,
			valueType: formValueTypes[rule.format],
			suggestions: rule.suggestions,
		})
	let binaryQuestion = rule => ({
			component: Question,
			choices: [
					{ value: 'non', label: 'Non' },
					{ value: 'oui', label: 'Oui' },
			],
		})
	let multiChoiceQuestion = rule => ({
				component: Question,
				choices: buildVariantTree(flatRules, dottedName)
		})

	let common = constructStepMeta(rule)

	return Object.assign(
		common,
		isVariant(rule) ?
			multiChoiceQuestion(rule) :
			rule.format == null ?
				binaryQuestion(rule) :
				typeof rule.suggestions == 'string' ?
					(rule.suggestions == 'atmp-2017' ? selectAtmp(rule) : selectQuestion(rule)) :
					inputQuestion(rule)
	)
}
