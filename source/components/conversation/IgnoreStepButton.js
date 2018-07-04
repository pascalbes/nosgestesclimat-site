import HoverDecorator from 'Components/HoverDecorator'
import React, { Component } from 'react'
import { Trans, translate } from 'react-i18next'

@HoverDecorator
@translate()
export default class IgnoreStepButton extends Component {
	componentDidMount() {
		// removeEventListener will need the exact same function instance
		this.boundHandleKeyDown = this.handleKeyDown.bind(this)

		window.addEventListener('keydown', this.boundHandleKeyDown)
	}
	handleKeyDown({ key }) {
		if (key !== 'Escape') return
		document.activeElement.blur()
		this.props.onClick()
	}
	componentWillUnmount() {
		window.removeEventListener('keydown', this.boundHandleKeyDown)
	}
	render() {
		return (
			<>
				<button className="ui__ skip-button" onClick={this.props.onClick}>
					<Trans>Passer</Trans>
				</button>
				<span className="keyIcon" style={{ opacity: this.props.hover ? 1 : 0 }}>
					<Trans>Échap</Trans>
				</span>
			</>
		)
	}
}
